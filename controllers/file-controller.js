const {
  convertFile,
  getAllowedTargetFormats,
  getDownloadUrl,
  getUploadUrl,
} = require('../services/conversion-service');

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function healthCheck(req, res) {
  return res.json({
    ok: true,
    service: 'file-converter-api',
    supportedFormats: ['pdf', 'docx', 'jpg', 'png'],
  });
}

function getFormats(req, res) {
  const extension = (req.params.extension || '').toLowerCase();

  return res.json({
    sourceFormat: extension,
    targets: getAllowedTargetFormats(extension),
  });
}

async function createDownloadUrl(req, res) {
  try {
    const { fileName } = req.body;
    const result = await getDownloadUrl(fileName);
    return res.status(200).json({ url: result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

async function createUploadUrl(req, res) {
  try {
    const { fileName, contentType } = req.body;
    const result = await getUploadUrl(fileName, contentType);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

async function convert(req, res) {
  const { fileName, fileContents, outputFormat } = req.body || {};

  if (!fileName || !fileContents || !outputFormat) {
    return res.status(400).json({
      message: 'fileName, fileContents, and outputFormat are required.',
    });
  }

  const fileBufferSize = Buffer.byteLength(fileContents, 'base64');

  if (fileBufferSize > MAX_FILE_SIZE) {
    return res.status(413).json({ message: 'File too large. Maximum is 50MB.' });
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

    if (result.uploadedKey) {
      res.setHeader('X-Uploaded-Key', result.uploadedKey);
    }

    return res.send(result.buffer);
  } catch (error) {
    const statusCode = error.statusCode || 500;

    return res.status(statusCode).json({
      message: error.message || 'File conversion failed.',
    });
  }
}

const FileController = {
  convert,
  getFormats,
  healthCheck,
  createUploadUrl,
  createDownloadUrl,
};

module.exports = FileController;
