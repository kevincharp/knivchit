//! Geometría pura para elegir el monitor objetivo de una captura.
//!
//! El portal devuelve UNA imagen de todo el escritorio; el overlay
//! fullscreen cubre un solo monitor. Aquí se decide qué monitor está bajo el
//! cursor y qué rectángulo de la imagen le corresponde. Sin Tauri ni GTK:
//! entradas explícitas, para poder probarlo.

/// Un monitor tal como lo reporta Tauri (`available_monitors`): posición y
/// tamaño en el espacio de coordenadas del escritorio.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonitorGeom {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Informativo. La fórmula no lo usa: normaliza por la razón
    /// imagen/escritorio, que absorbe un factor de escala uniforme.
    pub scale_factor: f64,
}

/// Rectángulo en píxeles de la imagen del portal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CropRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl MonitorGeom {
    fn right(&self) -> i64 {
        self.x as i64 + self.width as i64
    }
    fn bottom(&self) -> i64 {
        self.y as i64 + self.height as i64
    }
}

/// Índice del monitor bajo el cursor. Si el cursor no cae dentro de ninguno
/// (o no se pudo leer), el más cercano; sin cursor, el primero. `None` solo
/// si no hay monitores.
pub fn pick_monitor(monitors: &[MonitorGeom], cursor: Option<(f64, f64)>) -> Option<usize> {
    if monitors.is_empty() {
        return None;
    }
    let Some((cx, cy)) = cursor else {
        return Some(0);
    };
    // contención semiabierta: el borde derecho/inferior pertenece al vecino
    if let Some(i) = monitors.iter().position(|m| {
        cx >= m.x as f64 && cx < m.right() as f64 && cy >= m.y as f64 && cy < m.bottom() as f64
    }) {
        return Some(i);
    }
    let distance_sq = |m: &MonitorGeom| {
        let dx = (m.x as f64 - cx).max(cx - m.right() as f64).max(0.0);
        let dy = (m.y as f64 - cy).max(cy - m.bottom() as f64).max(0.0);
        dx * dx + dy * dy
    };
    monitors
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| distance_sq(a).total_cmp(&distance_sq(b)))
        .map(|(i, _)| i)
}

/// Rectángulo de la imagen del portal que corresponde al monitor `index`.
///
/// La imagen cubre la caja envolvente de todos los monitores, con origen en su esquina mínima. Si
/// difieren de tamaño (p. ej. escala fraccional), se reescala por la razón imagen/caja en cada eje.
/// Con escala 1.0 coincide con lo medido en un GNOME real (1600×900 + 1280×720); con otras escalas
/// y monitores de escala mixta es una suposición sin verificar.
pub fn crop_rect_for_monitor(
    monitors: &[MonitorGeom],
    index: usize,
    image: (u32, u32),
) -> Result<CropRect, String> {
    let monitor = monitors
        .get(index)
        .ok_or_else(|| "índice de monitor fuera de rango".to_string())?;
    let (img_w, img_h) = image;
    if img_w == 0 || img_h == 0 {
        return Err("la imagen del portal tiene dimensiones cero".to_string());
    }
    let min_x = monitors.iter().map(|m| m.x as i64).min().unwrap_or(0);
    let min_y = monitors.iter().map(|m| m.y as i64).min().unwrap_or(0);
    let max_x = monitors.iter().map(MonitorGeom::right).max().unwrap_or(0);
    let max_y = monitors.iter().map(MonitorGeom::bottom).max().unwrap_or(0);
    let (bbox_w, bbox_h) = ((max_x - min_x) as f64, (max_y - min_y) as f64);
    if bbox_w <= 0.0 || bbox_h <= 0.0 {
        return Err("los monitores reportan un escritorio de tamaño cero".to_string());
    }
    let (sx, sy) = (img_w as f64 / bbox_w, img_h as f64 / bbox_h);

    let edge = |v: i64, scale: f64, limit: u32| ((v as f64 * scale).round() as i64).clamp(0, limit as i64) as u32;
    let x0 = edge(monitor.x as i64 - min_x, sx, img_w);
    let x1 = edge(monitor.right() - min_x, sx, img_w);
    let y0 = edge(monitor.y as i64 - min_y, sy, img_h);
    let y1 = edge(monitor.bottom() - min_y, sy, img_h);
    if x1 <= x0 || y1 <= y0 {
        return Err("el monitor queda fuera de la imagen del portal".to_string());
    }
    Ok(CropRect {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayWatch {
    /// El overlay ya se ve: el flujo terminó bien.
    Visible,
    KeepWaiting,
    /// Venció el plazo sin que apareciera: destruir y restaurar la UI.
    GiveUp,
}

/// Decisión del salvavidas, pura: recibe el estado observado.
pub fn overlay_watch(visible: bool, elapsed_ms: u64, timeout_ms: u64) -> OverlayWatch {
    if visible {
        OverlayWatch::Visible
    } else if elapsed_ms >= timeout_ms {
        OverlayWatch::GiveUp
    } else {
        OverlayWatch::KeepWaiting
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdleWatch {
    /// La captura ya se consumió o canceló: no hay nada que vigilar.
    Finished,
    Waiting,
    /// Demasiado tiempo sin interacción: cancelar y restaurar la UI.
    Expire,
}

/// Última defensa contra un overlay abandonado o inalcanzable (p. ej. sin
/// foco de teclado): decisión pura a partir del estado observado.
pub fn idle_watch(capture_pending: bool, idle_ms: u64, limit_ms: u64) -> IdleWatch {
    if !capture_pending {
        IdleWatch::Finished
    } else if idle_ms >= limit_ms {
        IdleWatch::Expire
    } else {
        IdleWatch::Waiting
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(x: i32, y: i32, w: u32, h: u32, scale: f64) -> MonitorGeom {
        MonitorGeom { x, y, width: w, height: h, scale_factor: scale }
    }

    /// Caso medido en un GNOME real: 1600×900 + 1280×720, imagen 2880×900.
    fn two() -> Vec<MonitorGeom> {
        vec![mon(0, 0, 1600, 900, 1.0), mon(1600, 0, 1280, 720, 1.0)]
    }

    #[test]
    fn pick_monitor_prefers_the_one_containing_the_cursor() {
        let m = two();
        assert_eq!(pick_monitor(&m, Some((10.0, 10.0))), Some(0));
        assert_eq!(pick_monitor(&m, Some((1700.0, 300.0))), Some(1));
        assert_eq!(pick_monitor(&m, Some((1600.0, 0.0))), Some(1));
    }

    #[test]
    fn pick_monitor_falls_back_to_nearest_then_first_then_none() {
        let m = two();
        // bajo el monitor 1 (que mide 720 de alto): fuera de ambos, más cerca del 1
        assert_eq!(pick_monitor(&m, Some((2000.0, 880.0))), Some(1));
        assert_eq!(pick_monitor(&m, Some((-50.0, -50.0))), Some(0));
        assert_eq!(pick_monitor(&m, None), Some(0));
        assert_eq!(pick_monitor(&[], Some((0.0, 0.0))), None);
    }

    #[test]
    fn crop_rect_matches_the_real_two_monitor_layout() {
        let m = two();
        assert_eq!(
            crop_rect_for_monitor(&m, 0, (2880, 900)),
            Ok(CropRect { x: 0, y: 0, width: 1600, height: 900 })
        );
        assert_eq!(
            crop_rect_for_monitor(&m, 1, (2880, 900)),
            Ok(CropRect { x: 1600, y: 0, width: 1280, height: 720 })
        );
    }

    #[test]
    fn crop_rect_is_relative_to_the_minimum_origin_with_negative_positions() {
        // monitor secundario a la izquierda y más arriba (origen negativo)
        let m = vec![mon(-1280, -200, 1280, 720, 1.0), mon(0, 0, 1920, 1080, 1.0)];
        assert_eq!(
            crop_rect_for_monitor(&m, 0, (3200, 1280)),
            Ok(CropRect { x: 0, y: 0, width: 1280, height: 720 })
        );
        assert_eq!(
            crop_rect_for_monitor(&m, 1, (3200, 1280)),
            Ok(CropRect { x: 1280, y: 200, width: 1920, height: 1080 })
        );
    }

    #[test]
    fn single_monitor_crops_the_whole_image() {
        let m = vec![mon(0, 0, 1920, 1080, 1.0)];
        assert_eq!(
            crop_rect_for_monitor(&m, 0, (1920, 1080)),
            Ok(CropRect { x: 0, y: 0, width: 1920, height: 1080 })
        );
    }

    // SUPOSICIÓN (no verificada en GNOME real): Tauri reporta tamaños lógicos
    // (físico / escala) y la imagen del portal viene en píxeles físicos; la
    // razón imagen/escritorio lo compensa.
    #[test]
    fn assumption_scale_1_25_logical_monitor_sizes_map_to_physical_pixels() {
        // dos monitores físicos 2400×1350 a 1.25 → lógicos 1920×1080
        let m = vec![mon(0, 0, 1920, 1080, 1.25), mon(1920, 0, 1920, 1080, 1.25)];
        assert_eq!(
            crop_rect_for_monitor(&m, 1, (4800, 1350)),
            Ok(CropRect { x: 2400, y: 0, width: 2400, height: 1350 })
        );
    }

    #[test]
    fn assumption_scale_1_5_logical_monitor_sizes_map_to_physical_pixels() {
        // físico 3840×2160 a 1.5 → lógico 2560×1440
        let m = vec![mon(0, 0, 2560, 1440, 1.5), mon(2560, 0, 2560, 1440, 1.5)];
        assert_eq!(
            crop_rect_for_monitor(&m, 0, (7680, 2160)),
            Ok(CropRect { x: 0, y: 0, width: 3840, height: 2160 })
        );
        assert_eq!(
            crop_rect_for_monitor(&m, 1, (7680, 2160)),
            Ok(CropRect { x: 3840, y: 0, width: 3840, height: 2160 })
        );
    }

    #[test]
    fn crop_rect_rejects_bad_inputs() {
        let m = two();
        assert!(crop_rect_for_monitor(&m, 5, (2880, 900)).is_err());
        assert!(crop_rect_for_monitor(&m, 0, (0, 900)).is_err());
        assert!(crop_rect_for_monitor(&[mon(0, 0, 0, 0, 1.0)], 0, (100, 100)).is_err());
    }

    #[test]
    fn crop_rect_never_exceeds_the_image() {
        let m = two();
        // imagen más pequeña que el escritorio: sigue dentro de los límites
        let r = crop_rect_for_monitor(&m, 1, (1000, 500)).unwrap();
        assert!(r.x + r.width <= 1000 && r.y + r.height <= 500);
    }

    #[test]
    fn overlay_watch_decides_from_observed_state() {
        assert_eq!(overlay_watch(true, 0, 5000), OverlayWatch::Visible);
        assert_eq!(overlay_watch(true, 9000, 5000), OverlayWatch::Visible);
        assert_eq!(overlay_watch(false, 4999, 5000), OverlayWatch::KeepWaiting);
        assert_eq!(overlay_watch(false, 5000, 5000), OverlayWatch::GiveUp);
    }

    #[test]
    fn idle_watch_expires_only_a_pending_capture_past_the_limit() {
        assert_eq!(idle_watch(false, 999_999, 60_000), IdleWatch::Finished);
        assert_eq!(idle_watch(true, 59_999, 60_000), IdleWatch::Waiting);
        assert_eq!(idle_watch(true, 60_000, 60_000), IdleWatch::Expire);
    }

}
