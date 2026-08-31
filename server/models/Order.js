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
  coupon: { type: String, default: '' },           // coupon code applied (e.g. YASEEN200)
  discount: { type: Number, default: 0 },          // discount amount in rupees
  paid: { type: Boolean, default: false },         // true once Razorpay payment is verified
  paymentId: { type: String, default: '' },        // Razorpay payment id (pay_XXXX)
  razorpayOrderId: { type: String, default: '' },  // Razorpay order id (order_XXXX)
  status: { type: String, default: 'Confirmed' },
  // when each status was set, e.g. [{ status:'Confirmed', at:169... }, { status:'Shipped', at:... }]
  // — drives the timestamped delivery timeline on the public track page
  statusHistory: { type: Array, default: [] },
  cancelReason: { type: String, default: '' },
  cancelledAt: { type: Number, default: null },
  refundStatus: { type: String, default: '' },
  date: { type: Number, default: () => Date.now() }
});

// One Razorpay payment / order backs exactly ONE stored order — enforced by the DB
// (partial so the many orders with empty '' ids are exempt). A concurrent double
// submit now hits a duplicate-key error instead of creating a second paid order.
OrderSchema.index({ paymentId: 1 }, { unique: true, partialFilterExpression: { paymentId: { $gt: '' } } });
OrderSchema.index({ razorpayOrderId: 1 }, { unique: true, partialFilterExpression: { razorpayOrderId: { $gt: '' } } });

module.exports = mongoose.model('Order', OrderSchema);
