const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const apiRoutes = require('./routes/fileConverter');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '75mb' }));

app.get('/', (req, res) => {
  res.json({ message: 'hello from api server' });
});

app.use('/api', apiRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

module.exports = app;
