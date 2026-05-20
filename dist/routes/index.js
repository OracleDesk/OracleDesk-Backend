"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const market_routes_1 = __importDefault(require("./market.routes"));
const trace_routes_1 = __importDefault(require("./trace.routes"));
const portfolio_routes_1 = __importDefault(require("./portfolio.routes"));
const trade_routes_1 = __importDefault(require("./trade.routes"));
const oracle_routes_1 = __importDefault(require("./oracle.routes"));
const trade_controller_1 = require("../controllers/trade.controller");
const router = (0, express_1.Router)();
// Auth
router.post('/auth/connect', trade_controller_1.connectWallet);
// Feature routes
router.use('/markets', market_routes_1.default);
router.use('/traces', trace_routes_1.default);
router.use('/portfolio', portfolio_routes_1.default);
router.use('/trade', trade_routes_1.default);
router.use('/oracle', oracle_routes_1.default);
exports.default = router;
