const ExcelJS = require('exceljs');

/**
 * Sanitize cell values against Excel formula injection (CSV/Excel DDE attacks)
 * Characters =, +, -, @, \t, \r at start of strings force formula evaluation in Excel.
 */
function sanitizeCell(val) {
  if (typeof val !== 'string') return val;
  if (/^[\=\+\-\@\t\r]/.test(val)) {
    return `'${val}`;
  }
  return val;
}

function sanitizeOrderRow(order) {
  const sanitized = {};
  for (const [key, val] of Object.entries(order)) {
    sanitized[key] = sanitizeCell(val);
  }
  return sanitized;
}

/**
 * Generate a production warehouse pick-and-pack Excel spreadsheet buffer
 * @param {Array} orders - Array of normalized order items
 * @param {string} shopDomain - Store domain (e.g. hk-mart-cfoepmjd.myshopify.com)
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 */
async function generateOrdersWorkbook(orders, shopDomain = 'store') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OrderDrop Automation';
  workbook.created = new Date();

  const cleanShopName = shopDomain
    .replace('.myshopify.com', '')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const todayStr = new Date().toISOString().split('T')[0];
  const worksheet = workbook.addWorksheet('Unfulfilled Orders');

  worksheet.columns = [
    { header: 'Order #', key: 'name', width: 14 },
    { header: 'Order Date', key: 'date', width: 14 },
    { header: 'Customer Name', key: 'customer', width: 22 },
    { header: 'Customer Email', key: 'email', width: 26 },
    { header: 'SKU', key: 'sku', width: 18 },
    { header: 'Item Title', key: 'item', width: 30 },
    { header: 'Quantity', key: 'qty', width: 10 },
    { header: 'Unit Price', key: 'unitPrice', width: 14 },
    { header: 'Order Total', key: 'total', width: 14 },
    { header: 'Status', key: 'status', width: 20 },
    { header: 'Shipping Address', key: 'address', width: 40 }
  ];

  // Header Row Styling (Navy Slate #0F172A, Bold White Text)
  const headerRow = worksheet.getRow(1);
  headerRow.height = 26;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };

  if (!orders || orders.length === 0) {
    const emptyRow = worksheet.addRow({
      name: 'N/A',
      date: todayStr,
      customer: 'No pending unfulfilled orders today',
      email: '-',
      sku: '-',
      item: '-',
      qty: 0,
      unitPrice: '-',
      total: '-',
      status: 'ALL FULFILLED',
      address: '-'
    });
    emptyRow.font = { italic: true, color: { argb: 'FF64748B' } };
  } else {
    orders.forEach((order, index) => {
      const sanitized = sanitizeOrderRow(order);
      const row = worksheet.addRow(sanitized);
      // Alternating row background for warehouse legibility
      if (index % 2 === 1) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' }
        };
      }
      row.alignment = { vertical: 'middle' };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${cleanShopName}_Orders_${todayStr}.xlsx`;

  return { buffer: Buffer.from(buffer), filename };
}

module.exports = {
  generateOrdersWorkbook,
  sanitizeCell
};
