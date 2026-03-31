const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { convertFile, getAllowedTargetFormats } = require('./services/conversion-service');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'file-converter-api',
    supportedFormats: ['pdf', 'docx', 'jpg', 'png'],
  });
});

app.get('/api/formats/:extension', (req, res) => {
  const extension = (req.params.extension || '').toLowerCase();
  res.json({
    sourceFormat: extension,
    targets: getAllowedTargetFormats(extension),
  });
});

app.post('/api/convert', async (req, res) => {
  const { fileName, fileContents, outputFormat } = req.body || {};

  if (!fileName || !fileContents || !outputFormat) {
    return res.status(400).json({
      message: 'fileName, fileContents, and outputFormat are required.',
    });
  }

  try {
    const result = await convertFile({
      fileName,
      fileContents,
      outputFormat,
    });

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.outputFileName}"`,
    );

    return res.send(result.buffer);
  } catch (error) {
    const statusCode = error.statusCode || 500;

    return res.status(statusCode).json({
      message: error.message || 'File conversion failed.',
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

module.exports = app;
