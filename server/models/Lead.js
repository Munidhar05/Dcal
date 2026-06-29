const mongoose = require('mongoose');

/* A free-demo-kit form submission. Captured WITHOUT login — anyone who fills
   the form creates one of these, and they surface in the admin "Demo Kits" tab
   (and its Excel/CSV export). */
const LeadSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  phone: { type: String, index: true, default: '' },
  email: { type: String, default: '' },
  age: { type: String, default: '' },
  address: { type: String, default: '' },
  village: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  pincode: { type: String, default: '' },
  source: { type: String, default: '' },
  home_type: { type: String, default: '' },
  createdAt: { type: Number, default: () => Date.now(), index: true }
});

module.exports = mongoose.model('Lead', LeadSchema);
