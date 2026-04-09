const express = require('express');
const fileController = require('../controllers/file-controller');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'hello from /api' });
});

router.get('/health', fileController.healthCheck);
router.get('/formats/:extension', fileController.getFormats);
router.post('/convert', fileController.convert);
router.post('/download-url', fileController.createDownloadUrl);
router.post('/upload-url', fileController.createUploadUrl);

module.exports = router;
