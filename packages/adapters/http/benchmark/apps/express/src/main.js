import express from 'express';

const port = Number(process.env['BENCH_PORT'] ?? 3000);
const app = express();

app.get('/', (_req, res) => {
  res.json({ message: 'Hello, World!' });
});

app.listen(port, () => {
  console.log(`Express listening on :${port}`);
});
