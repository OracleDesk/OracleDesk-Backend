"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const trace_controller_1 = require("../controllers/trace.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
// Public
router.get('/', trace_controller_1.listTraces);
router.get('/access/allowance', auth_middleware_1.requireAuth, trace_controller_1.getMySpendingAllowance);
router.put('/access/allowance', auth_middleware_1.requireAuth, trace_controller_1.setSpendingAllowance);
router.get('/payments', auth_middleware_1.requireAuth, trace_controller_1.getMyPaymentEvents);
router.get('/:id', trace_controller_1.getTrace); // Returns preview if unauthenticated
// Protected
router.post('/verify', auth_middleware_1.requireAuth, trace_controller_1.verifyTrace);
router.post('/:id/unlock', auth_middleware_1.requireAuth, trace_controller_1.unlockTrace);
exports.default = router;
