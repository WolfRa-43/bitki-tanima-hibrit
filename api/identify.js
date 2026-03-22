module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.PLANTNET_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "PLANTNET_API_KEY bulunamadı."
      });
    }

    const localName = req.headers["x-local-name"] || "";
    const localTurkish = req.headers["x-local-turkish"] || "";
    const localCategory = req.headers["x-local-category"] || "";
    const localScore = Number(req.headers["x-local-score"] || 0);

    // Local eşleşme yeterince güçlüyse direkt dön
    if (localScore >= 0.85) {
      return res.status(200).json({
        source: "local",
        data: {
          name: localName,
          turkish: localTurkish,
          category: localCategory,
          score: localScore
        }
      });
    }

    // Binary body oku
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({
        error: "Dosya verisi alınamadı."
      });
    }

    const mimeType = req.headers["content-type"] || "image/jpeg";

    if (!["image/jpeg", "image/png", "image/jpg"].includes(mimeType)) {
      return res.status(400).json({
        error: "Sadece JPG veya PNG desteklenir."
      });
    }

    const formData = new FormData();
    formData.append("images", new Blob([buffer], { type: mimeType }), "plant.jpg");
    formData.append("organs", "leaf");
    formData.append("nb-results", "3");
    formData.append("lang", "tr");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);

    const response = await fetch(
      `https://my-api.plantnet.org/v2/identify/all?api-key=${apiKey}`,
      {
        method: "POST",
        body: formData,
        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: result?.message || "PlantNet hata verdi",
        details: result
      });
    }

    if (!result.results || result.results.length === 0) {
      return res.status(200).json({
        source: "none",
        message: "Bitki bulunamadı."
      });
    }

    const best = result.results[0];

    return res.status(200).json({
      source: "plantnet",
      data: {
        name:
          best?.species?.scientificNameWithoutAuthor ||
          result.bestMatch ||
          "Bilinmiyor",
        family:
          best?.species?.family?.scientificName ||
          "Bilinmiyor",
        commonNames: best?.species?.commonNames || [],
        score: best?.score || 0
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return res.status(504).json({
        error: "PlantNet isteği zaman aşımına uğradı."
      });
    }

    return res.status(500).json({
      error: error.message || "Sunucu hatası."
    });
  }
};