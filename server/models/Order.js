const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  orderId: { type: String, index: true },     // short id shown to the customer (e.g. 48217391)
  mobile: { type: String, index: true },       // owner's phone number
  customerName: { type: String, default: '' },
  title: { type: String, default: '' },
  total: { type: String, default: '' },        // display string, e.g. "₹1,234.00"
  totalNum: { type: Number, default: 0 },       // numeric value, for summing revenue
  image: { type: String, default: '' },
  items: { type: Array, default: [] },
  address: { type: Object, default: {} },
  payment: { type: String, default: '' },
  status: { type: String, default: 'Confirmed' },
  date: { type: Number, default: () => Date.now() }
});

module.exports = mongoose.model('Order', OrderSchema);
