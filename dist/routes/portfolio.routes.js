"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const portfolio_controller_1 = require("../controllers/portfolio.controller");
const router = (0, express_1.Router)();
// Public (agent portfolio is public for demo)
router.get('/', portfolio_controller_1.getPortfolio);
router.get('/positions', portfolio_controller_1.getPositions);
exports.default = router;
