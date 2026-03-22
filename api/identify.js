const fs = require("fs");
const path = require("path");

module.exports = async (req, res) => {
  try {
    const filePath = path.join(process.cwd(), "data", "plants.json");
    const rawData = fs.readFileSync(filePath, "utf8");
    const parsedData = JSON.parse(rawData);

    return res.status(200).json(parsedData);
  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
};