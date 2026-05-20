"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const market_controller_1 = require("../controllers/market.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
// Public — no auth needed
router.get('/', market_controller_1.listMarkets);
router.get('/:id', market_controller_1.getMarket);
// Protected — requires JWT
router.post('/generate', auth_middleware_1.requireAuth, market_controller_1.triggerMarketGeneration);
router.get('/generation-status/:jobId', auth_middleware_1.requireAuth, market_controller_1.getMarketGenerationStatus);
exports.default = router;
