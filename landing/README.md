# Landing de Knivchit

Sitio estático de promoción de Knivchit (vista previa temprana, `VERSION` en `src/config.json`). **La página publicada está solo en inglés**; el español queda archivado en `src/strings/archive/es.json` para un futuro `/es/`. HTML, CSS y JavaScript sin dependencias de ejecución, cero peticiones externas y tipografías autoalojadas. **Aún no está desplegado**: este directorio solo lo deja listo.

```
landing/
├── site/            ← LO QUE SE DESPLIEGA (HTML generado, CSS, JS, fuentes, imágenes, _headers…)
├── src/             ← plantillas, parciales, constantes (config.json) y textos (strings/en.json)
├── scripts/         ← build.mjs, check.mjs, serve.mjs, imagenes.mjs, verify-browser.mjs, og-source.html
├── capturas/        ← capturas de referencia (no se despliegan)
├── fuentes/         ← (ignorada por git) capturas reales sin procesar para scripts/imagenes.mjs
├── wrangler.toml    ← Cloudflare Pages
└── vercel.json      ← Vercel (mismas cabeceras que site/_headers)
```

## Cómo se edita

Todo el contenido sale de tres sitios; `site/index.html` y `site/404.html` son **resultado** (se versionan, pero no se tocan a mano).

| Quiero cambiar… | Edito |
|---|---|
| Un texto | `src/strings/en.json` |
| `REPO_URL`, `RELEASE_URL`, `SITE_URL`, versión | `src/config.json` |
| Estructura de la página | `src/index.template.html` y `src/partials/` |
| Aspecto | `site/assets/css/styles.css` (los tokens copian `app/src/styles/theme.css`) |

Después: `node landing/scripts/build.mjs` y `node landing/scripts/check.mjs`. Solo hace falta Node ≥ 20.

### Activar el botón de descarga y el enlace al código

`REPO_URL` y `RELEASE_URL` están vacías: el sitio muestra «Disponible próximamente» y «Repositorio público próximamente». Cuando existan, rellénalas en `src/config.json` (o `SITE_URL=… node scripts/build.mjs`) y vuelve a generar: el botón «Instalar», el enlace «Código fuente», el JSON-LD (`downloadUrl`, `codeRepository`) y la respuesta de las preguntas frecuentes cambian solos. Los pasos de instalación conservan el aviso de «todavía no hay versión» hasta que `RELEASE_URL` tenga valor.

`SITE_URL` (hoy `https://knivchit.pages.dev`, **provisional**) alimenta la URL canónica, Open Graph, `sitemap.xml` y `robots.txt`. Hay que fijarla al dominio real antes de publicar.

### Otro idioma

Hoy solo se construye `LOCALE: "en"`. `src/strings/archive/es.json` es la versión anterior en español: sus claves son de una estructura previa (sin ranuras de capturas, «porqué», ajustes ni contribuir), así que hay que portarla a la estructura de `en.json` antes de usarla. Servir dos idiomas a la vez (rutas `/es/`) requeriría ampliar `build.mjs`.

## Reglas de contenido

Solo lo que existe y está probado; portapapeles, OCR, traducción, emojis y stickers van como «Coming soon» (sin fechas); estado: «Early preview, not stable yet» en el héroe, la instalación y las FAQ; versiones: «Tested on GNOME 50»; la interfaz de la app está en español y la página lo dice; sin testimonios, cifras ni marcas ajenas. `check.mjs` vigila algunas (cifras de usuarios, otras marcas, «GNOME 45-49», valoraciones en JSON-LD).

## Imágenes y ranuras de capturas reales

La página tiene **tres ranuras** para capturas reales de la app. Mientras no haya imagen, el sitio muestra un marcador naranja «SCREENSHOT PENDING» con el nombre de archivo y la proporción; `check.mjs` lo avisa y **`check.mjs --release` falla**: no se publica hasta que estén las tres. (El diagrama animado de «How it works» está etiquetado «Diagram» y no es una captura.)

Cada captura se hace **a resolución nativa, sin escalar ni recortar a mano**, en PNG, y se deja en `landing/fuentes/<ranura>.png` (carpeta ignorada por git: las fuentes pesan).

| Ranura | Archivo | Proporción y mínimo | Anchos generados | Dónde aparece |
|---|---|---|---|---|
| Overlay con selección y anotaciones | `overlay.png` | 8:5, ≥ 2560×1600 | 640 · 1280 · 1920 · 2560 | bajo el héroe |
| Ventana principal | `hub.png` | 2:3, ≥ 720×1080 | 360 · 720 | sección de ajustes |
| Tarjeta de atajos | `shortcuts.png` | libre, ≥ 960 de ancho | 480 · 960 | sección de ajustes |

```sh
node landing/scripts/imagenes.mjs     # convierte las que haya (o: … overlay hub)
node landing/scripts/build.mjs        # las publica en la página
node landing/scripts/check.mjs --release
```

**Renders de la interfaz como sustituto temporal.** Si en `landing/fuentes/` existe un archivo `SIMULADAS` (vacío; la carpeta está ignorada por git), `imagenes.mjs` marca las ranuras como simuladas en `src/slots.json`: la página las llama «Interface preview» (alt y pie distintos, `previewAlt` y `previewCaption` en `strings/en.json`, nunca «screenshot») y `check.mjs` emite un AVISO visible, sin bloquear, para sustituirlas por capturas reales antes del lanzamiento público. Al regenerar con capturas reales, borra `SIMULADAS`.

`imagenes.mjs` genera `site/assets/img/<ranura>-<ancho>.webp` (y `.avif` si hay `avifenc` o un `magick` con AVIF; esta máquina solo tiene WebP), anota las ranuras listas en `src/slots.json` y rechaza una fuente con la proporción equivocada o demasiado pequeña en vez de recortarla. `build.mjs` genera el `<picture>` con `srcset`, `sizes`, `width` y `height`; el texto alternativo y el pie salen de `slots.*` en `strings/en.json`. Las imágenes generadas y `slots.json` sí se versionan. Si en lugar de imágenes llega un vídeo, hace falta además `media-src 'self'` en la CSP de `_headers` **y** de `vercel.json`.

`site/assets/img/og.jpg` (1200×630) y `site/apple-touch-icon.png` salen de los archivos de marca (logo) y de `scripts/og-source.html`. Se versionan por ser pequeños (< 50 KB).

## Verificar

```sh
node landing/scripts/build.mjs      # regenera site/
node landing/scripts/check.mjs      # pesos, enlaces, metadatos, CSP, honestidad (--release: también exige las capturas)
node landing/scripts/serve.mjs      # http://localhost:8765 con las cabeceras de _headers
```

Capturas en cuatro anchos y dos temas, axe, peticiones externas y teclado: `scripts/verify-browser.mjs` (cabecera con los requisitos). Última verificación: 0 peticiones externas y 0 violaciones de axe en 4 anchos y 2 temas, Lighthouse 100/100/100/100 en escritorio y 99/100/100/100 en móvil; solo se probó en Chromium, y el rendimiento real depende de la plataforma de despliegue.

## Desplegar (NO está hecho)

Antes de cualquier despliegue: fijar `SITE_URL` al dominio real y volver a generar. Nada de esto crea proyectos ni dominios por sí solo.

### Cloudflare Pages (plataforma por defecto)

Con integración Git (recomendado):

1. Cloudflare → *Workers & Pages* → *Create* → *Pages* → *Connect to Git*, y elegir el repositorio.
2. *Root directory*: `landing` · *Build command*: `node scripts/build.mjs` (o ninguno: `site/` ya está generado) · *Build output directory*: `site`.
3. En *Environment variables* opcional: `SITE_URL=https://tu-dominio`. Node ≥ 20 (`NODE_VERSION=22`).
4. Cloudflare lee `site/_headers` y `site/_redirects` solo; no hace falta más.
5. *Custom domains* → añadir el dominio; con DNS en Cloudflare crea el registro CNAME sola.

Directo desde la máquina: `cd landing && npx wrangler pages deploy site --project-name knivchit` (requiere `wrangler login`).

### Vercel

1. *Add New… → Project*, importar el repositorio.
2. *Root Directory*: `landing`. Framework: *Other*. `vercel.json` ya fija `buildCommand` y `outputDirectory`.
3. *Settings → Environment Variables*: `SITE_URL=https://tu-dominio`. *Settings → Domains* para el dominio.

Vercel usa las cabeceras de `vercel.json`; `check.mjs` comprueba que su CSP coincide con la de `_headers`. Los archivos `_headers` y `_redirects` se servirán como ficheros inertes, sin efecto.

## Pendiente del usuario

Las tres capturas reales (`overlay`, `hub`, `shortcuts`; ver «Imágenes y ranuras»); el dominio definitivo (`SITE_URL`); `REPO_URL` y `RELEASE_URL` cuando el repositorio sea público y haya release; confirmar el nombre exacto de la etiqueta de la versión alpha. La licencia de `landing/` y `docs/` ya está decidida: MIT (`LICENSE` de la raíz).
