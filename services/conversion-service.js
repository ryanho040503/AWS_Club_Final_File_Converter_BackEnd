const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

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

function createS3Client() {
  return new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

function getBucketName() {
  return (
    process.env.AWS_S3_BUCKET ||
    process.env.S3_BUCKET_NAME ||
    'aws-file-converter-ho-hoang-duy'
  );
}

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

function buildOutputFileName(fileName, targetFormat) {
  const outputBaseName = sanitizeBaseName(fileName);
  return `${outputBaseName}-${randomUUID()}.${targetFormat}`;
}

async function getDownloadUrl(fileName) {
  const s3Client = createS3Client();
  const s3Object = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: `originals/${fileName}`,
  });

  const url = await getSignedUrl(s3Client, s3Object, { expiresIn: 3600 });
  console.log('Generated download URL:', url);
  return url;
}

async function getUploadUrl(fileName, contentType) {
  const s3Client = createS3Client();
  const key = `originals/${fileName}`;
  const s3Object = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, s3Object, { expiresIn: 3600 });
  console.log('Generated upload URL:', uploadUrl);

  return {
    uploadUrl,
    key,
  };
}

async function uploadConvertedFile(buffer, outputFileName, contentType) {
  const convertedKey = `converted/${outputFileName}`;
  const s3Client = createS3Client();

  await s3Client.send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: convertedKey,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  console.log('Uploaded converted file to S3:', convertedKey);
  return convertedKey;
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
    const outputFileName = buildOutputFileName(fileName, targetFormat);
    const uploadedKey = await uploadConvertedFile(
      buffer,
      outputFileName,
      MIME_TYPES[targetFormat],
    );

    return {
      buffer,
      mimeType: MIME_TYPES[targetFormat],
      outputFileName,
      uploadedKey,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  convertFile,
  getAllowedTargetFormats,
  getDownloadUrl,
  getUploadUrl,
};
