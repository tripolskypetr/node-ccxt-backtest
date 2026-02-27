(function (global, factory) {
  if (typeof define === "function" && define.amd) {
    define("Executor", ["@backtest-kit/pinets", "backtest-kit", "functools-kit", "@backtest-kit/graph"], factory);
  } else if (typeof exports !== "undefined") {
    factory(require("@backtest-kit/pinets"), require("backtest-kit"), require("functools-kit"), require("@backtest-kit/graph"));
  } else {
    var mod = {
      exports: {}
    };
    factory(global.pinets, global.BacktestKit, global.functoolsKit, global.graph);
    global.Executor = mod.exports;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function (_pinets, _backtestKit, _functoolsKit, _graph) {
  "use strict";

  function _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }
  function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
  function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
  function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
  function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
  function _arrayWithHoles(r) { if (Array.isArray(r)) return r; }
  function _regenerator() { /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */ var e, t, r = "function" == typeof Symbol ? Symbol : {}, n = r.iterator || "@@iterator", o = r.toStringTag || "@@toStringTag"; function i(r, n, o, i) { var c = n && n.prototype instanceof Generator ? n : Generator, u = Object.create(c.prototype); return _regeneratorDefine2(u, "_invoke", function (r, n, o) { var i, c, u, f = 0, p = o || [], y = !1, G = { p: 0, n: 0, v: e, a: d, f: d.bind(e, 4), d: function d(t, r) { return i = t, c = 0, u = e, G.n = r, a; } }; function d(r, n) { for (c = r, u = n, t = 0; !y && f && !o && t < p.length; t++) { var o, i = p[t], d = G.p, l = i[2]; r > 3 ? (o = l === n) && (u = i[(c = i[4]) ? 5 : (c = 3, 3)], i[4] = i[5] = e) : i[0] <= d && ((o = r < 2 && d < i[1]) ? (c = 0, G.v = n, G.n = i[1]) : d < l && (o = r < 3 || i[0] > n || n > l) && (i[4] = r, i[5] = n, G.n = l, c = 0)); } if (o || r > 1) return a; throw y = !0, n; } return function (o, p, l) { if (f > 1) throw TypeError("Generator is already running"); for (y && 1 === p && d(p, l), c = p, u = l; (t = c < 2 ? e : u) || !y;) { i || (c ? c < 3 ? (c > 1 && (G.n = -1), d(c, u)) : G.n = u : G.v = u); try { if (f = 2, i) { if (c || (o = "next"), t = i[o]) { if (!(t = t.call(i, u))) throw TypeError("iterator result is not an object"); if (!t.done) return t; u = t.value, c < 2 && (c = 0); } else 1 === c && (t = i["return"]) && t.call(i), c < 2 && (u = TypeError("The iterator does not provide a '" + o + "' method"), c = 1); i = e; } else if ((t = (y = G.n < 0) ? u : r.call(n, G)) !== a) break; } catch (t) { i = e, c = 1, u = t; } finally { f = 1; } } return { value: t, done: y }; }; }(r, o, i), !0), u; } var a = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} t = Object.getPrototypeOf; var c = [][n] ? t(t([][n]())) : (_regeneratorDefine2(t = {}, n, function () { return this; }), t), u = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(c); function f(e) { return Object.setPrototypeOf ? Object.setPrototypeOf(e, GeneratorFunctionPrototype) : (e.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine2(e, o, "GeneratorFunction")), e.prototype = Object.create(u), e; } return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine2(u, "constructor", GeneratorFunctionPrototype), _regeneratorDefine2(GeneratorFunctionPrototype, "constructor", GeneratorFunction), GeneratorFunction.displayName = "GeneratorFunction", _regeneratorDefine2(GeneratorFunctionPrototype, o, "GeneratorFunction"), _regeneratorDefine2(u), _regeneratorDefine2(u, o, "Generator"), _regeneratorDefine2(u, n, function () { return this; }), _regeneratorDefine2(u, "toString", function () { return "[object Generator]"; }), (_regenerator = function _regenerator() { return { w: i, m: f }; })(); }
  function _regeneratorDefine2(e, r, n, t) { var i = Object.defineProperty; try { i({}, "", {}); } catch (e) { i = 0; } _regeneratorDefine2 = function _regeneratorDefine(e, r, n, t) { function o(r, n) { _regeneratorDefine2(e, r, function (e) { return this._invoke(r, n, e); }); } r ? i ? i(e, r, { value: n, enumerable: !t, configurable: !t, writable: !t }) : e[r] = n : (o("next", 0), o("throw", 1), o("return", 2)); }, _regeneratorDefine2(e, r, n, t); }
  function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
  function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
  var directionTimeframe = (0, _graph.sourceNode)(_backtestKit.Cache.fn(/*#__PURE__*/function () {
    var _ref = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee(symbol) {
      var plots;
      return _regenerator().w(function (_context) {
        while (1) switch (_context.n) {
          case 0:
            _context.n = 1;
            return (0, _pinets.run)(_pinets.File.fromPath("extreme_direction_1m.pine", "../math"), {
              symbol: symbol,
              timeframe: "1m",
              limit: 240
            });
          case 1:
            plots = _context.v;
            return _context.a(2, (0, _pinets.extract)(plots, {
              trend: "Trend"
            }));
        }
      }, _callee);
    }));
    return function (_x) {
      return _ref.apply(this, arguments);
    };
  }(), {
    interval: "1m",
    key: function key(_ref2) {
      var _ref3 = _slicedToArray(_ref2, 1),
        symbol = _ref3[0];
      return symbol;
    }
  }));
  var goldenCrossTimeframe = (0, _graph.sourceNode)(_backtestKit.Cache.fn(/*#__PURE__*/function () {
    var _ref4 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee2(symbol) {
      var plots;
      return _regenerator().w(function (_context2) {
        while (1) switch (_context2.n) {
          case 0:
            _context2.n = 1;
            return (0, _pinets.run)(_pinets.File.fromPath("ema_golden_cross_15m.pine", "../math"), {
              symbol: symbol,
              timeframe: "15m",
              limit: 100
            });
          case 1:
            plots = _context2.v;
            return _context2.a(2, (0, _pinets.extract)(plots, {
              position: "Signal",
              priceOpen: "Close"
            }));
        }
      }, _callee2);
    }));
    return function (_x2) {
      return _ref4.apply(this, arguments);
    };
  }(), {
    interval: "15m",
    key: function key(_ref5) {
      var _ref6 = _slicedToArray(_ref5, 1),
        symbol = _ref6[0];
      return symbol;
    }
  }));
  var strategySignal = (0, _graph.outputNode)(/*#__PURE__*/function () {
    var _ref8 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee3(_ref7) {
      var _ref9, direction, goldenCross, isLong;
      return _regenerator().w(function (_context3) {
        while (1) switch (_context3.n) {
          case 0:
            _ref9 = _slicedToArray(_ref7, 2), direction = _ref9[0], goldenCross = _ref9[1];
            if (!(goldenCross.position === 0)) {
              _context3.n = 1;
              break;
            }
            return _context3.a(2, null);
          case 1:
            if (!(direction.trend === -1 && goldenCross.position === 1)) {
              _context3.n = 2;
              break;
            }
            return _context3.a(2, null);
          case 2:
            if (!(direction.trend === 1 && goldenCross.position === -1)) {
              _context3.n = 3;
              break;
            }
            return _context3.a(2, null);
          case 3:
            isLong = goldenCross.position === 1;
            return _context3.a(2, {
              id: (0, _functoolsKit.randomString)(),
              position: isLong ? "long" : "short",
              priceTakeProfit: isLong ? goldenCross.priceOpen * 1.01 : goldenCross.priceOpen * 0.99,
              priceStopLoss: isLong ? goldenCross.priceOpen * 0.99 : goldenCross.priceOpen * 1.01,
              minuteEstimatedTime: 240
            });
        }
      }, _callee3);
    }));
    return function (_x3) {
      return _ref8.apply(this, arguments);
    };
  }(), directionTimeframe, goldenCrossTimeframe);
  (0, _backtestKit.addStrategySchema)({
    strategyName: "trailing_stop_strategy",
    interval: "15m",
    getSignal: function getSignal() {
      return (0, _graph.resolve)(strategySignal);
    }
  });
});