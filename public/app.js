let model;
let plantsData = [];
let datasetEmbeddings = [];
let selectedFile = null;

const imageInput = document.getElementById("imageInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const preview = document.getElementById("preview");
const result = document.getElementById("result");

imageInput.addEventListener("change", (event) => {
  selectedFile = event.target.files[0];

  if (selectedFile) {
    preview.src = URL.createObjectURL(selectedFile);
    preview.style.display = "block";
  }
});

analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile) {
    result.textContent = "Lütfen foto seç.";
    return;
  }

  try {
    result.textContent = "Analiz ediliyor...";

    const uploadedImg = await loadImageFromFile(selectedFile);
    const uploadedEmbedding = await getEmbedding(uploadedImg);

    let bestMatch = null;
    let bestScore = -1;

    for (const item of datasetEmbeddings) {
      const score = cosineSimilarity(uploadedEmbedding, item.embedding);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = item;
      }
    }

    const base64 = await fileToBase64(selectedFile);

    const apiResponse = await fetch("/api/identify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        imageBase64: base64,
        localResult: {
          name: bestMatch.name,
          turkish: bestMatch.turkish,
          category: bestMatch.category,
          score: bestScore
        }
      })
    });

    const apiData = await apiResponse.json();

    if (apiData.source === "local") {
      result.textContent =
        `Bitki: ${apiData.data.name}\n` +
        `Türkçe: ${apiData.data.turkish}\n` +
        `Benzerlik: %${(apiData.data.score * 100).toFixed(2)}\n` +
        `Kaynak: Sistem`;
    }

    if (apiData.source === "plantnet") {
      result.textContent =
        `Bitki: ${apiData.data.name}\n` +
        `Aile: ${apiData.data.family}\n` +
        `Kaynak: PlantNet\n` +
        `Güven: %${(apiData.data.score * 100).toFixed(2)}`;
    }

    if (apiData.source === "none") {
      result.textContent = "Bitki bulunamadı.";
    }

  } catch (error) {
    result.textContent = "Hata: " + error.message;
  }
});

async function init() {
  model = await mobilenet.load();

  const response = await fetch("/api/plants");
  const data = await response.json();

  plantsData = data.plants;

  for (const plant of plantsData) {
    for (const imgName of plant.images) {
      const img = await loadImageFromUrl(`/images/${imgName}`);
      const embedding = await getEmbedding(img);

      datasetEmbeddings.push({
        name: plant.name,
        turkish: plant.turkish,
        category: plant.category,
        embedding
      });
    }
  }

  result.textContent = "Sistem hazır.";
}

async function loadImageFromUrl(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = src;
  });
}

async function loadImageFromFile(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = URL.createObjectURL(file);
  });
}

async function getEmbedding(img) {
  return tf.tidy(() => model.infer(img, true));
}

function cosineSimilarity(a, b) {
  return tf.tidy(() => {
    const dot = a.mul(b).sum();
    const normA = a.norm();
    const normB = b.norm();
    return dot.div(normA.mul(normB)).dataSync()[0];
  });
}

async function fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

init();