// Stands in for DHL Shipment Tracking in end-to-end tests, so they never spend the shared
// demo-key quota. Answers like DHL: a mocked shipment, or a 401 problem document.
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://stub');
  if (url.pathname === '/health') {
    res.end('ok');
    return;
  }
  if (req.headers['dhl-api-key'] !== 'demo-key' || url.searchParams.get('trackingNumber') === 'UNAUTHORISED') {
    res.writeHead(401, { 'content-type': 'application/problem+json' });
    res.end(JSON.stringify({ status: 401, title: 'Unauthorized', detail: 'Unauthorized for given resource.' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    shipments: [{
      id: url.searchParams.get('trackingNumber'),
      service: 'ecommerce',
      status: { timestamp: '2023-05-08T10:37:00', statusCode: 'delivered', description: 'DELIVERED (stub)' },
    }],
  }));
});

server.listen(8081, '0.0.0.0');
