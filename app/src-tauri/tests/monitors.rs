//! Huecos que no cubren las pruebas internas de `monitors.rs`: cursor fuera
//! de todo monitor, empates, monitor mayor que la imagen, teselado sin huecos
//! con escalas fraccionales y entradas extremas. Solo API pública.

use knivchit_lib::monitors::{
    crop_rect_for_monitor, overlay_watch, pick_monitor, CropRect, MonitorGeom, OverlayWatch,
};

fn mon(x: i32, y: i32, w: u32, h: u32) -> MonitorGeom {
    MonitorGeom {
        x,
        y,
        width: w,
        height: h,
        scale_factor: 1.0,
    }
}

// ----------------------------------------------------------------- pick_monitor

#[test]
fn cursor_outside_every_monitor_picks_the_nearest_in_each_direction() {
    let m = vec![mon(0, 0, 1000, 1000), mon(1000, 0, 1000, 1000)];
    assert_eq!(
        pick_monitor(&m, Some((-500.0, 500.0))),
        Some(0),
        "izquierda"
    );
    assert_eq!(pick_monitor(&m, Some((2500.0, 500.0))), Some(1), "derecha");
    assert_eq!(pick_monitor(&m, Some((400.0, -300.0))), Some(0), "arriba");
    assert_eq!(pick_monitor(&m, Some((1600.0, 1800.0))), Some(1), "abajo");
}

#[test]
fn cursor_in_a_gap_between_staggered_monitors_picks_a_real_monitor() {
    // el segundo monitor es más bajo: queda un hueco bajo él
    let m = vec![mon(0, 0, 1600, 900), mon(1600, 0, 1280, 720)];
    let i = pick_monitor(&m, Some((2000.0, 800.0))).unwrap();
    assert_eq!(i, 1, "el más cercano es el de 1280×720");
}

#[test]
fn equidistant_cursor_is_deterministic() {
    let m = vec![mon(0, 0, 100, 100), mon(300, 0, 100, 100)];
    // x=200 está a 100 de ambos
    let a = pick_monitor(&m, Some((200.0, 50.0)));
    assert!(a == Some(0) || a == Some(1));
    assert_eq!(a, pick_monitor(&m, Some((200.0, 50.0))));
}

#[test]
fn cursor_on_the_bottom_and_right_edges_belongs_to_the_neighbour_or_nearest() {
    let m = vec![mon(0, 0, 100, 100)];
    // contención semiabierta, pero con un solo monitor siempre se elige ese
    assert_eq!(pick_monitor(&m, Some((100.0, 100.0))), Some(0));
    assert_eq!(pick_monitor(&m, Some((99.999, 99.999))), Some(0));
}

#[test]
fn vertically_stacked_monitors_are_told_apart() {
    let m = vec![mon(0, 0, 1920, 1080), mon(0, 1080, 1920, 1080)];
    assert_eq!(pick_monitor(&m, Some((500.0, 1079.0))), Some(0));
    assert_eq!(pick_monitor(&m, Some((500.0, 1080.0))), Some(1));
}

#[test]
fn nan_and_infinite_cursors_never_panic() {
    let m = vec![mon(0, 0, 100, 100), mon(100, 0, 100, 100)];
    for c in [
        (f64::NAN, f64::NAN),
        (f64::INFINITY, 0.0),
        (f64::NEG_INFINITY, f64::INFINITY),
        (1e300, -1e300),
    ] {
        let r = pick_monitor(&m, Some(c));
        assert!(r.is_some_and(|i| i < m.len()), "cursor {c:?} → {r:?}");
    }
}

#[test]
fn the_picked_index_is_always_in_range() {
    let m = vec![
        mon(-500, -500, 400, 300),
        mon(0, 0, 800, 600),
        mon(900, 200, 300, 300),
    ];
    for cx in (-1000..2000).step_by(137) {
        for cy in (-1000..1500).step_by(131) {
            let i = pick_monitor(&m, Some((cx as f64, cy as f64))).unwrap();
            assert!(i < m.len());
        }
    }
}

// ------------------------------------------------------------ crop_rect_for_monitor

#[test]
fn single_monitor_with_a_nonzero_origin_crops_the_whole_image() {
    let m = vec![mon(250, -40, 1920, 1080)];
    assert_eq!(
        crop_rect_for_monitor(&m, 0, (1920, 1080)),
        Ok(CropRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080
        })
    );
}

#[test]
fn hidpi_integer_scale_doubles_the_crop() {
    // Tauri reporta lógicos 1920×1080 ×2 monitores; la imagen es física (×2)
    let m = vec![mon(0, 0, 1920, 1080), mon(1920, 0, 1920, 1080)];
    assert_eq!(
        crop_rect_for_monitor(&m, 1, (7680, 2160)),
        Ok(CropRect {
            x: 3840,
            y: 0,
            width: 3840,
            height: 2160
        })
    );
}

#[test]
fn monitor_larger_than_the_image_stays_inside_the_image() {
    // imagen mucho más pequeña que lo que reportan los monitores
    let m = vec![mon(0, 0, 4000, 3000), mon(4000, 0, 4000, 3000)];
    for i in 0..2 {
        let r = crop_rect_for_monitor(&m, i, (800, 300)).unwrap();
        assert!(r.width > 0 && r.height > 0);
        assert!(r.x + r.width <= 800 && r.y + r.height <= 300, "{r:?}");
    }
}

#[test]
fn image_larger_than_the_desktop_still_covers_the_monitor() {
    let m = vec![mon(0, 0, 100, 100)];
    assert_eq!(
        crop_rect_for_monitor(&m, 0, (400, 300)),
        Ok(CropRect {
            x: 0,
            y: 0,
            width: 400,
            height: 300
        })
    );
}

#[test]
fn fractional_ratios_tile_without_gaps_or_overlaps() {
    // razón 1.5 con tamaños impares: el borde compartido redondea igual a ambos lados
    let m = vec![
        mon(0, 0, 1281, 721),
        mon(1281, 0, 1279, 721),
        mon(2560, 0, 641, 721),
    ];
    let img = (4801, 1082);
    let r: Vec<_> = (0..3)
        .map(|i| crop_rect_for_monitor(&m, i, img).unwrap())
        .collect();
    assert_eq!(r[0].x, 0);
    assert_eq!(r[0].x + r[0].width, r[1].x, "sin hueco entre 0 y 1");
    assert_eq!(r[1].x + r[1].width, r[2].x, "sin hueco entre 1 y 2");
    assert_eq!(r[2].x + r[2].width, img.0, "el último llega al borde");
}

#[test]
fn crops_of_a_non_overlapping_layout_never_overlap() {
    let m = vec![
        mon(0, 0, 1920, 1080),
        mon(1920, 0, 1280, 1024),
        mon(0, 1080, 1920, 1080),
    ];
    let img = (3200, 2160);
    let r: Vec<_> = (0..3)
        .map(|i| crop_rect_for_monitor(&m, i, img).unwrap())
        .collect();
    for a in 0..3 {
        for b in (a + 1)..3 {
            let (p, q) = (r[a], r[b]);
            let overlap = p.x < q.x + q.width
                && q.x < p.x + p.width
                && p.y < q.y + q.height
                && q.y < p.y + p.height;
            assert!(!overlap, "{p:?} se solapa con {q:?}");
        }
    }
}

#[test]
fn every_crop_stays_inside_the_image_for_many_layouts_and_sizes() {
    let layouts: Vec<Vec<MonitorGeom>> = vec![
        vec![mon(0, 0, 1920, 1080)],
        vec![mon(-1920, 0, 1920, 1080), mon(0, 0, 2560, 1440)],
        vec![
            mon(0, 0, 1366, 768),
            mon(1366, -200, 1920, 1080),
            mon(-640, 768, 640, 480),
        ],
    ];
    let imgs = [
        (1, 1),
        (640, 480),
        (1920, 1080),
        (3840, 2160),
        (7000, 3000),
        (65535, 1),
    ];
    for m in &layouts {
        for &img in &imgs {
            for i in 0..m.len() {
                if let Ok(r) = crop_rect_for_monitor(m, i, img) {
                    assert!(r.width > 0 && r.height > 0);
                    assert!(r.x + r.width <= img.0, "{m:?} {img:?} {r:?}");
                    assert!(r.y + r.height <= img.1, "{m:?} {img:?} {r:?}");
                }
            }
        }
    }
}

#[test]
fn degenerate_inputs_return_errors_instead_of_panicking() {
    let m = vec![mon(0, 0, 100, 100)];
    assert!(
        crop_rect_for_monitor(&[], 0, (100, 100)).is_err(),
        "sin monitores"
    );
    assert!(crop_rect_for_monitor(&m, 1, (100, 100)).is_err(), "índice");
    assert!(crop_rect_for_monitor(&m, usize::MAX, (100, 100)).is_err());
    assert!(crop_rect_for_monitor(&m, 0, (100, 0)).is_err());
    assert!(crop_rect_for_monitor(&[mon(0, 0, 100, 0)], 0, (100, 100)).is_err());
    // un monitor de tamaño cero junto a uno válido: el cero no tiene recorte
    let con_cero = vec![mon(0, 0, 100, 100), mon(100, 0, 0, 0)];
    assert!(crop_rect_for_monitor(&con_cero, 1, (100, 100)).is_err());
    assert!(crop_rect_for_monitor(&con_cero, 0, (100, 100)).is_ok());
}

#[test]
fn extreme_coordinates_do_not_overflow() {
    let m = vec![
        mon(i32::MIN, i32::MIN, u32::MAX, u32::MAX),
        mon(i32::MAX, i32::MAX, u32::MAX, u32::MAX),
    ];
    for i in 0..2 {
        let _ = crop_rect_for_monitor(&m, i, (u32::MAX, u32::MAX));
        let _ = crop_rect_for_monitor(&m, i, (100, 100));
    }
    let _ = pick_monitor(&m, Some((0.0, 0.0)));
}

// ---------------------------------------------------------------- overlay_watch

#[test]
fn watchdog_gives_up_at_exactly_the_timeout_and_not_before() {
    assert_eq!(overlay_watch(false, 4999, 5000), OverlayWatch::KeepWaiting);
    assert_eq!(overlay_watch(false, 5000, 5000), OverlayWatch::GiveUp);
    assert_eq!(overlay_watch(false, u64::MAX, 5000), OverlayWatch::GiveUp);
}

#[test]
fn watchdog_never_gives_up_on_a_visible_overlay() {
    for elapsed in [0, 1, 5000, 60_000, u64::MAX] {
        assert_eq!(overlay_watch(true, elapsed, 5000), OverlayWatch::Visible);
    }
}

#[test]
fn watchdog_with_zero_timeout_gives_up_immediately_unless_visible() {
    assert_eq!(overlay_watch(false, 0, 0), OverlayWatch::GiveUp);
    assert_eq!(overlay_watch(true, 0, 0), OverlayWatch::Visible);
}
