// Esta función vive en el servidor de Vercel, nunca en el navegador del usuario.
// La API Key se lee de una variable de entorno (GEMINI_API_KEY), configurada
// en el panel de Vercel — nunca queda visible en el código ni en GitHub.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido." });
  }

  const { tipo, materia, nivel, detalle } = req.body || {};

  if (!materia || !nivel) {
    return res.status(400).json({ error: "Faltan datos: materia y nivel son obligatorios." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "El servidor no tiene configurada la API Key (GEMINI_API_KEY)." });
  }

  const prompt = construirPrompt(tipo, materia, nivel, detalle);

  // Modelo principal configurable desde Vercel (variable GEMINI_MODEL).
  // Si no se configura, usa este valor por defecto.
  const modeloPrincipal = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  // Modelo de respaldo: si el principal está saturado (error 503) o fue
  // descontinuado (404), se reintenta automáticamente con este.
  const modeloRespaldo = process.env.GEMINI_MODEL_FALLBACK || "gemini-2.5-flash";

  try {
    let resultado = await llamarGemini(modeloPrincipal, apiKey, prompt);

    if (!resultado.ok && (resultado.status === 503 || resultado.status === 404)) {
      resultado = await llamarGemini(modeloRespaldo, apiKey, prompt);
    }

    if (!resultado.ok) {
      return res.status(resultado.status).json({ error: resultado.error });
    }

    return res.status(200).json({ texto: resultado.texto });
  } catch (err) {
    return res.status(500).json({ error: "Error inesperado del servidor: " + err.message });
  }
}

async function llamarGemini(modelo, apiKey, prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    const msg = data?.error?.message || "Error al contactar la API de Gemini.";
    return { ok: false, status: response.status, error: msg };
  }

  const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!texto) {
    return { ok: false, status: 502, error: "La IA respondió pero no se encontró contenido generado." };
  }

  return { ok: true, texto };
}

function construirPrompt(tipo, materia, nivel, detalle) {
  const base = `Eres un asistente experto en pedagogía y diseño curricular. Responde en español, con formato claro usando títulos y listas cuando aplique.`;

  if (tipo === "rubrica") {
    return `${base}
Genera una RÚBRICA de evaluación para la materia "${materia}", nivel educativo "${nivel}".
Enfoque/detalle solicitado: ${detalle || "sin detalle adicional"}.
Incluye:
1. De 4 a 6 criterios de evaluación relevantes.
2. 4 niveles de desempeño por criterio (Excelente, Bueno, Aceptable, Necesita mejorar).
3. Descripción breve y clara de qué se espera en cada nivel de cada criterio.
4. Presenta el resultado como una tabla en texto (usa | para separar columnas).`;
  }

  if (tipo === "adaptacion") {
    return `${base}
Genera una ADAPTACIÓN CURRICULAR para la materia "${materia}", nivel educativo "${nivel}".
Enfoque/detalle solicitado: ${detalle || "sin detalle adicional"}.
Incluye:
1. Objetivos de aprendizaje ajustados.
2. Estrategias metodológicas específicas (materiales, tiempos, apoyos).
3. Criterios de evaluación adaptados.
4. Sugerencias de acompañamiento para el docente.`;
  }

  // examen (por defecto)
  return `${base}
Genera un EXAMEN completo para la materia "${materia}", nivel educativo "${nivel}".
Enfoque/detalle solicitado: ${detalle || "sin detalle adicional"}.
Incluye:
1. Encabezado con espacio para nombre y fecha.
2. Entre 6 y 10 preguntas variadas (opción múltiple, verdadero/falso, respuesta abierta).
3. Al final, una sección separada titulada "CLAVE DE RESPUESTAS" con la respuesta correcta de cada pregunta y una breve justificación.`;
}
