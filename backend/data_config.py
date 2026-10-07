TRIP = {
    "name": "Viaje fin de ano · Lima + Paracas",
    "group": {"total": 11, "couples": 5, "solos": 1},
    "currency": "USD",
    "segments": [
        {
            "id": "lima1",
            "label": "Lima · llegada",
            "city": "Lima",
            "check_in": "2026-12-30",
            "check_out": "2027-01-03",
            "anchor_set": "lima",
        },
        {
            "id": "paracas",
            "label": "Paracas (Ica)",
            "city": "Paracas",
            "check_in": "2027-01-04",
            "check_out": "2027-01-06",
            "anchor_set": "paracas",
        },
        {
            "id": "lima2",
            "label": "Lima · cierre",
            "city": "Lima",
            "check_in": "2027-01-06",
            "check_out": "2027-01-10",
            "anchor_set": "lima",
        },
    ],
}

ANCHOR_SETS = {
    "lima": [
        {"key": "aeropuerto", "label": "Aeropuerto Jorge Chavez (LIM)", "lat": -12.0219, "lng": -77.1143, "weight": 3},
        {"key": "centro", "label": "Plaza Mayor / Centro Historico", "lat": -12.0464, "lng": -77.0428, "weight": 2},
        {"key": "miraflores", "label": "Miraflores (Parque Kennedy)", "lat": -12.1219, "lng": -77.0297, "weight": 3},
        {"key": "barranco", "label": "Barranco (Puente de los Suspiros)", "lat": -12.1469, "lng": -77.0206, "weight": 2},
        {"key": "sanisidro", "label": "San Isidro (Bosque El Olivar)", "lat": -12.0972, "lng": -77.0365, "weight": 2},
        {"key": "larcomar", "label": "Larcomar / Costa Verde", "lat": -12.1316, "lng": -77.0305, "weight": 2},
    ],
    "paracas": [
        {"key": "plaza", "label": "Plaza de Armas de Paracas", "lat": -13.8378, "lng": -76.2520, "weight": 3},
        {"key": "muelle", "label": "Muelle El Chaco (Islas Ballestas)", "lat": -13.8317, "lng": -76.2494, "weight": 3},
        {"key": "reserva", "label": "Reserva Nacional de Paracas", "lat": -13.8947, "lng": -76.2656, "weight": 2},
        {"key": "pisco", "label": "Aeropuerto de Pisco", "lat": -13.7449, "lng": -76.2203, "weight": 2},
    ],
}

DISTRICT_SAFETY = {
    "miraflores": (9.0, "Distrito turistico, muy vigilado, alta oferta gastronomica."),
    "san isidro": (9.0, "Zona financiera, residencial y tranquila."),
    "san borja": (8.5, "Residencial ordenado, buena iluminacion."),
    "santiago de surco": (8.0, "Residencial amplio, seguro de dia, cuidado de noche."),
    "surco": (8.0, "Residencial amplio, seguro de dia, cuidado de noche."),
    "la molina": (8.0, "Residencial, calles amplias, baja densidad comercial."),
    "barranco": (7.5, "Turistico y bohemio; moverse por calles iluminadas de noche."),
    "jesus maria": (7.5, "Central y residencial; precaucion en avenidas grandes."),
    "jesus maría": (7.5, "Central y residencial; precaucion en avenidas grandes."),
    "lince": (7.0, "Central, comercial; normal de dia, atencion de noche."),
    "magdalena del mar": (7.5, "Residencial junto al malecón, tranquilo."),
    "magdalena": (7.5, "Residencial junto al malecón, tranquilo."),
    "san miguel": (7.0, "Comercial y residencial; zonas dispares."),
    "pueblo libre": (7.5, "Residencial, cerca de universidades y museos."),
    "surquillo": (7.0, "Comercial, muy conectado; concurrido."),
    "chorrillos": (6.5, "Amplio; malecón turistico seguro, interior variable."),
    "san juan de miraflores": (5.0, "Periferia; evitar calles sin iluminacion de noche."),
    "villa el salvador": (4.5, "Periferia sur, zonas con incidencia."),
    "cercado de lima": (5.0, "Centro historico; turistico de dia, precaucion de noche."),
    "lima": (5.0, "Centro historico; turistico de dia, precaucion de noche."),
    "brena": (5.0, "Central; zonas comerciales y residenciales mezcladas."),
    "breña": (5.0, "Central; zonas comerciales y residenciales mezcladas."),
    "rimac": (4.5, "Historico; incidencia mayor, transitar con cuidado."),
    "la victoria": (4.0, "Comercial muy denso; incidencia relativamente alta."),
    "callao": (4.5, "Puerto; zonas dispares, turistico en La Punta y Monumental."),
    "bellavista": (5.0, "Residencial; cercania al aeropuerto."),
    "el agustino": (3.5, "Periferia este; incidencia alta, evitar de noche."),
    "san juan de lurigancho": (3.0, "Distrito denso; incidencia alta en zonas altas."),
    "santa anita": (4.0, "Periferia este; variable."),
    "ate": (4.0, "Periferia este; variable."),
    "los olivos": (5.0, "Norte; comercial y residencial, variable."),
    "independencia": (4.0, "Norte; variable, cuidado de noche."),
    "comas": (3.5, "Norte; incidencia alta en zonas altas."),
    "san martin de porres": (4.0, "Norte denso; variable."),
    "paracas": (7.0, "Balneario turistico; tranquilo, baja densidad."),
    "pisco": (5.5, "Ciudad portuaria; zonas turisticas seguras, interior variable."),
}

DISTRICT_BY_COORD = [
    (-12.0219, -77.1143, 3.0, "callao"),
]

DEFAULT_SAFETY = (6.0, "Sin dato especifico del barrio; evaluar en persona.")

POI_GROUPS = {
    "gastronomia": 'node["amenity"~"restaurant|cafe|fast_food|bar|pub"](around:{r},{lat},{lng});',
    "compras": 'node["shop"~"supermarket|convenience|bakery|greengrocer"](around:{r},{lat},{lng});',
    "salud": 'node["amenity"~"pharmacy|hospital|clinic|doctors"](around:{r},{lat},{lng});',
    "transporte": '(node["highway"="bus_stop"](around:{r},{lat},{lng});node["amenity"="taxi"](around:{r},{lat},{lng});node["railway"="station"](around:{r},{lat},{lng}););',
    "turismo": 'node["tourism"~"attraction|museum|viewpoint"](around:{r},{lat},{lng});',
    "bancos": 'node["amenity"="atm"](around:{r},{lat},{lng});',
}

CRITERIA = [
    {"key": "ubicacion", "label": "Ubicacion / traslados", "desc": "Que tan comodo queda moverse a los puntos clave.", "defaultWeight": 1.5},
    {"key": "precio", "label": "Precio", "desc": "Costo total para el grupo segun fechas.", "defaultWeight": 1.5},
    {"key": "capacidad", "label": "Capacidad y comodidad", "desc": "Que entren comodos los 11 y amenities.", "defaultWeight": 1.2},
    {"key": "calidad", "label": "Calidad / resenas", "desc": "Rating, resenas, superhost.", "defaultWeight": 1.0},
    {"key": "seguridad", "label": "Seguridad del barrio", "desc": "Percepcion y senales del entorno.", "defaultWeight": 1.2},
    {"key": "entorno", "label": "Entorno / caminabilidad", "desc": "Restaurantes, tiendas, transporte cerca.", "defaultWeight": 0.8},
]
