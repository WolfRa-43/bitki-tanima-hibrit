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

    const contentType = req.headers["content-type"] || "";

    if (!contentType.includes("multipart/form-data")) {
      return res.status(400).json({
        error: "Beklenen veri tipi multipart/form-data"
      });
    }

    // Basit multipart parser yerine Vercel Node ortamında gelen body'yi ham okuyamayız diye
    // kullanıcı tarafında local skor yüksekse direkt local döndürmek daha pratik olurdu.
    // Ama burada multipart ayrıştırma için req.formData() kullanıyoruz.

    const formData = await req.formData();

    const image = formData.get("image");
    const localName = formData.get("localName") || "";
    const localTurkish = formData.get("localTurkish") || "";
    const localCategory = formData.get("localCategory") || "";
    const localScore = Number(formData.get("localScore") || 0);

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

    if (!image) {
      return res.status(400).json({
        error: "Görsel alınamadı."
      });
    }

    const mimeType = image.type || "image/jpeg";

    if (!["image/jpeg", "image/png", "image/jpg"].includes(mimeType)) {
      return res.status(400).json({
        error: "Sadece JPG veya PNG desteklenir."
      });
    }

    const arrayBuffer = await image.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const plantForm = new FormData();
    plantForm.append("images", new Blob([buffer], { type: mimeType }), "plant.jpg");
    plantForm.append("organs", "leaf");
    plantForm.append("nb-results", "3");
    plantForm.append("lang", "tr");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);

    const response = await fetch(
      `https://my-api.plantnet.org/v2/identify/all?api-key=${apiKey}`,
      {
        method: "POST",
        body: plantForm,
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