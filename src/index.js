// --- ENDPOINT: Búsqueda en Google (Custom Search JSON API) ---
app.get('/api/google-search', async (req, res) => {
  const query = req.query.q;

  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Falta el parámetro de búsqueda "q".' });
  }

  const API_KEY = process.env.GOOGLE_API_KEY;
  const CSE_ID = process.env.GOOGLE_CSE_ID;

  if (!API_KEY || !CSE_ID) {
    console.error('[GoNex] GOOGLE_API_KEY o GOOGLE_CSE_ID no configuradas.');
    return res.status(500).json({ error: 'El servicio de búsqueda de Google no está configurado.' });
  }

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${CSE_ID}&q=${encodeURIComponent(query.trim())}`;
    
    const apiResponse = await fetch(url);
    
    if (!apiResponse.ok) {
      throw new Error(`Google API Error: ${apiResponse.status}`);
    }

    const data = await apiResponse.json();

    const results = (data.items || []).map((item) => ({
      title: item.title,
      url: item.link,
      description: item.snippet
    }));

    res.status(200).json({ results });

  } catch (error) {
    console.error('[GoNex] Error en /api/google-search:', error.message);
    res.status(500).json({ error: 'Error al buscar en Google.' });
  }
});