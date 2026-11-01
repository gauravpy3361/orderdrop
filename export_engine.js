const ExcelJS = require('exceljs');
const path = require('path');

// 1. Mock Data: Exactly what Shopify's Orders API returns
const mockShopifyOrders = [
  {
    id: 1001,
    name: "#1001",
    created_at: "2026-11-01T10:15:00Z",
    financial_status: "paid",
    fulfillment_status: "unfulfilled",
    total_price: "149.99",
    currency: "USD",
    customer: {
      first_name: "Sarah",
      last_name: "Connor",
      email: "sarah@example.com"
    },
    shipping_address: {
      address1: "123 Cyberdyne Way",
      city: "Los Angeles",
      province: "CA",
      zip: "90001",
      country: "United States"
    },
    line_items: [
      { name: "Heavy Duty Resistance Bands", quantity: 2, price: "29.99", sku: "FIT-BAND-01" },
      { name: "Adjustable Kettlebell 20kg", quantity: 1, price: "89.99", sku: "FIT-KB-20" }
    ]
  },
  {
    id: 1002,
    name: "#1002",
    created_at: "2026-11-01T11:42:00Z",
    financial_status: "paid",
    fulfillment_status: "unfulfilled",
    total_price: "45.00",
    currency: "USD",
    customer: {
      first_name: "John",
      last_name: "Rambo",
      email: "john@example.com"
    },
    shipping_address: {
      address1: "456 Mountain Pass Rd",
      city: "Bowie",
      province: "AZ",
      zip: "85605",
      country: "United States"
    },
    line_items: [
      { name: "Tactical Survival Water Bottle", quantity: 1, price: "45.00", sku: "TAC-BOTTLE" }
    ]
  }
];

// 2. The Core Engine: Transform raw Shopify JSON into a clean, professional Excel sheet
async function generateOrdersExcel(orders, outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OrderDrop';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Daily Orders');

  // Define columns and clean widths
  worksheet.columns = [
    { header: 'Order #', key: 'order_name', width: 14 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Customer', key: 'customer_name', width: 22 },
    { header: 'Email', key: 'customer_email', width: 26 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Item Name', key: 'item_name', width: 32 },
    { header: 'Qty', key: 'quantity', width: 10 },
    { header: 'Unit Price', key: 'item_price', width: 14 },
    { header: 'Total Order', key: 'total_price', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Shipping Address', key: 'shipping_address', width: 40 }
  ];

  // Style the Header Row (Dark blue background with bold white text)
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' } // Slate 800
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;

  // Add the rows (unrolling line items for warehouse pick-and-pack)
  orders.forEach((order) => {
    const formattedDate = new Date(order.created_at).toISOString().split('T')[0];
    const customerName = `${order.customer.first_name} ${order.customer.last_name}`;
    const addressStr = `${order.shipping_address.address1}, ${order.shipping_address.city}, ${order.shipping_address.province} ${order.shipping_address.zip}`;

    order.line_items.forEach((item) => {
      worksheet.addRow({
        order_name: order.name,
        date: formattedDate,
        customer_name: customerName,
        customer_email: order.customer.email,
        sku: item.sku,
        item_name: item.name,
        quantity: item.quantity,
        item_price: `$${parseFloat(item.price).toFixed(2)}`,
        total_price: `$${parseFloat(order.total_price).toFixed(2)}`,
        status: order.fulfillment_status.toUpperCase(),
        shipping_address: addressStr
      });
    });
  });

  // Write to disk
  await workbook.xlsx.writeFile(outputPath);
  console.log(`[SUCCESS] Excel spreadsheet generated at: ${outputPath}`);
}

// 3. Run the export
const outputFile = path.join(__dirname, 'orders_export.xlsx');
generateOrdersExcel(mockShopifyOrders, outputFile).catch(err => {
  console.error('[ERROR]', err);
});
