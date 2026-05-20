"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobStatus = void 0;
// ─── Enum types ───
var JobStatus;
(function (JobStatus) {
    JobStatus["RUNNING"] = "RUNNING";
    JobStatus["COMPLETED"] = "COMPLETED";
    JobStatus["FAILED"] = "FAILED";
    JobStatus["UNKNOWN"] = "UNKNOWN";
})(JobStatus || (exports.JobStatus = JobStatus = {}));
