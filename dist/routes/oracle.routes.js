"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const oracle_controller_1 = require("../controllers/oracle.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
router.get('/markets/:marketId/resolution', oracle_controller_1.getResolution);
router.post('/resolve', auth_middleware_1.requireAuth, oracle_controller_1.approveResolution);
exports.default = router;
