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

    const { imageBase64, localResult } = req.body || {};

    if (
      localResult &&
      typeof localResult.score === "number" &&
      localResult.score >= 0.85
    ) {
      return res.status(200).json({
        source: "local",
        data: localResult
      });
    }

    if (!imageBase64) {
      return res.status(400).json({
        error: "imageBase64 eksik."
      });
    }

    const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

    if (!match) {
      return res.status(400).json({
        error: "Geçersiz base64 formatı."
      });
    }

    const mimeType = match[1];
    const base64Data = match[2];

    if (!["image/jpeg", "image/png", "image/jpg"].includes(mimeType)) {
      return res.status(400).json({
        error: "Sadece JPG veya PNG desteklenir."
      });
    }

    const buffer = Buffer.from(base64Data, "base64");

    const formData = new FormData();
    formData.append("images", new Blob([buffer], { type: mimeType }), "plant.jpg");
    formData.append("organs", "auto");
    formData.append("nb-results", "3");
    formData.append("lang", "tr");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

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
      error: error.message
    });
  }
};