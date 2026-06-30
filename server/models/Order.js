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
  coupon: { type: String, default: '' },           // coupon code applied (e.g. DCAL200)
  discount: { type: Number, default: 0 },          // discount amount in rupees
  paid: { type: Boolean, default: false },         // true once Razorpay payment is verified
  paymentId: { type: String, default: '' },        // Razorpay payment id (e.g. pay_XXXX)
  status: { type: String, default: 'Confirmed' },
  cancelReason: { type: String, default: '' },
  cancelledAt: { type: Number, default: null },
  refundStatus: { type: String, default: '' },
  date: { type: Number, default: () => Date.now() }
});

module.exports = mongoose.model('Order', OrderSchema);
