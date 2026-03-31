const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const SUPPORTED_TARGETS = {
  pdf: ['png', 'jpg'],
  docx: ['pdf'],
  jpg: ['png', 'pdf'],
  jpeg: ['png', 'pdf'],
  png: ['jpg', 'pdf'],
};

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeBaseName(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'converted-file';
}

function normalizeExtension(extension) {
  return extension.toLowerCase() === 'jpeg' ? 'jpg' : extension.toLowerCase();
}

function getFileExtension(fileName) {
  return normalizeExtension(path.extname(fileName).replace('.', ''));
}

function getAllowedTargetFormats(extension) {
  return SUPPORTED_TARGETS[normalizeExtension(extension)] || [];
}

async function runCommand(command, args) {
  try {
    await execFileAsync(command, args);
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    throw createHttpError(
      500,
      stderr || `Conversion command failed: ${command}`,
    );
  }
}

async function convertWithLibreOffice(inputPath, outputDir) {
  await runCommand('libreoffice', [
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    outputDir,
    inputPath,
  ]);

  return path.join(
    outputDir,
    `${path.basename(inputPath, path.extname(inputPath))}.pdf`,
  );
}

async function convertWithImageMagick(inputPath, outputPath) {
  await runCommand('magick', [inputPath, outputPath]);
  return outputPath;
}

async function convertPdfToImage(inputPath, outputDir, targetFormat) {
  const baseOutput = path.join(outputDir, 'converted-page');
  await runCommand('pdftoppm', [`-${targetFormat}`, '-f', '1', '-singlefile', inputPath, baseOutput]);
  return `${baseOutput}.${targetFormat}`;
}

async function convertFile({ fileName, fileContents, outputFormat }) {
  const sourceFormat = getFileExtension(fileName);
  const targetFormat = normalizeExtension(outputFormat);
  const allowedTargets = getAllowedTargetFormats(sourceFormat);

  if (!sourceFormat || !MIME_TYPES[sourceFormat]) {
    throw createHttpError(400, 'Unsupported source file format.');
  }

  if (!allowedTargets.includes(targetFormat)) {
    throw createHttpError(
      400,
      `Unsupported conversion from ${sourceFormat.toUpperCase()} to ${targetFormat.toUpperCase()}.`,
    );
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-converter-'));
  const inputPath = path.join(tempDir, `source.${sourceFormat}`);
  const outputBaseName = sanitizeBaseName(fileName);

  try {
    await fs.writeFile(inputPath, Buffer.from(fileContents, 'base64'));

    let outputPath;

    if (sourceFormat === 'docx' && targetFormat === 'pdf') {
      outputPath = await convertWithLibreOffice(inputPath, tempDir);
    } else if (sourceFormat === 'pdf') {
      outputPath = await convertPdfToImage(inputPath, tempDir, targetFormat);
    } else {
      outputPath = path.join(tempDir, `converted.${targetFormat}`);
      outputPath = await convertWithImageMagick(inputPath, outputPath);
    }

    const buffer = await fs.readFile(outputPath);

    return {
      buffer,
      mimeType: MIME_TYPES[targetFormat],
      outputFileName: `${outputBaseName}.${targetFormat}`,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  convertFile,
  getAllowedTargetFormats,
};
