# Comparador de Airbnbs · Viaje fin de año (Lima + Paracas)

Web compartida para que un grupo de 11 personas (5 parejas + 1) compare opciones de
Airbnb para el viaje de fin de año, agregando cada opción con **un solo enlace** y
eligiendo un ganador por etapa.

- **Lima · llegada**: 2026-12-30 → 2027-01-03
- **Paracas (Ica)**: 2027-01-04 → 2027-01-06
- **Lima · cierre**: 2027-01-06 → 2027-01-10

## Qué hace

1. Pegás el enlace de un Airbnb (`airbnb.com/rooms/...`).
2. El backend extrae automáticamente: título, fotos, capacidad, tipo, superhost,
   calificación y reseñas, precio (si las fechas están disponibles), coordenadas.
3. Geocodifica el barrio y calcula **seguridad** (heurística por distrito) y
   **entorno** (conteo de POIs a 1 km vía OpenStreetMap → walk score).
4. Calcula **tiempos y distancias reales** desde la opción a los puntos clave de
   cada etapa (aeropuerto, centro, Miraflores, Barranco, etc. en Lima; plaza, muelle,
   reserva en Paracas) con OSRM.
5. Puntúa cada opción por 6 criterios ponderables (ubicación, precio, capacidad,
   calidad, seguridad, entorno) y combina el puntaje objetivo 50/50 con los **votos
   del grupo**.
6. Muestra tarjetas, un mapa con las opciones rankeadas y los puntos clave, y un
   **ranking con ganador parcial** por etapa.

## Stack y arquitectura

- **Backend**: Python 3 (stdlib `http.server`), `pyairbnb` para los datos del listing,
  `requests` para Nominatim / Overpass / OSRM. Estado en `data/db.json`.
- **Frontend**: HTML + JS vanilla (sin build) + Leaflet (CDN) para el mapa.
- **Exposición pública**: túnel de Cloudflare (`cloudflared`), URL `trycloudflare.com`.

```
backend/
  data_config.py   viaje, puntos clave (anchors), seguridad por distrito, criterios
  store.py         persistencia JSON (listings, votos, personas, pesos)
  enrich.py        scraping Airbnb + geocoding + POIs + rutas + seguridad
  server.py        API HTTP + estáticos + scoring/ranking
frontend/
  index.html, app.js, styles.css
run.sh             levanta backend + túnel
```

## Correr

```bash
./run.sh
```

o manual:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd backend && PORT=3000 ../.venv/bin/python server.py
cloudflared tunnel --url http://127.0.0.1:3000
```

API: `GET /api/health|trip|listings|results|votes`, `POST /api/listings|votes|weights`,
`POST /api/listings/<id>/refresh`, `DELETE /api/listings/<id>`.

## Por qué no reutilizamos una app existente

Se investigó el ecosistema open source antes de construir. Hallazgos:

- **No existe** un comparador de Airbnb de grupo, self-hosted y mantenido que haga el
  flujo completo "pegar URL → enriquecer → comparar → votar". Lo más cercano,
  [`StoyPenny/compair-bnb`](https://github.com/StoyPenny/compair-bnb), no extrae datos
  automáticamente (carga manual); sirvió de inspiración para el ranking ponderado.
- **Extracción**: [`johnbalvin/pyairbnb`](https://github.com/johnbalvin/pyairbnb) (MIT,
  activo) es lo mejor disponible. Airbnb **no tiene API pública** de listings.
- **Geo/rutas**: Nominatim (geocoding), Overpass (POIs) y OSRM (rutas), gratis y sin
  API key. Walk Score es propietario; se reimplementa el walk score con Overpass.
- **Seguridad por barrio**: no hay API abierta de criminalidad por distrito de Lima
  (INEI no expone REST; Numbeo es pago). Se usa una heurística por distrito editable en
  `backend/data_config.py`.
- **Votación**: en vez de integrar Loomio/RCV, se implementó un voto simple por persona
  + combinación con el puntaje objetivo, que es lo que necesita este caso.

## Nota legal

Extraer datos de Airbnb con medios automatizados está prohibido por sus Términos de
Servicio (§11.1). Este proyecto es de uso personal para ~11 listings, con pocas
peticiones y sin construir bases de datos masivas ni redistribuir datos. Si se quisiera
productizar, correspondería usar una API paga que asuma el riesgo.

## Limitaciones conocidas

- El precio solo aparece si las fechas exactas de la etapa están disponibles; si no,
  se muestra "—" y el criterio precio se omite del cálculo (se renormalizan los pesos).
- Airbnb puede devolver una página vacía por rate limiting si se piden muchos listings
  seguidos; el backend serializa y espacia las peticiones con reintentos.
- La seguridad del barrio es una estimación, no un dato oficial.
