const mongoose = require('mongoose');

// A tiny atomic sequence store. One document per counter key (e.g. "order:WS"),
// incremented with a single findByIdAndUpdate($inc) so concurrent orders can never
// get the same running number. Used to build per-product order numbers like DC01WS00001.
const CounterSchema = new mongoose.Schema({
  _id: { type: String },          // counter key, e.g. "order:WS"
  seq: { type: Number, default: 0 }
});

module.exports = mongoose.model('Counter', CounterSchema);
