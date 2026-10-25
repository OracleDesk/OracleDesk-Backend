import { Router, Request, Response } from 'express';
import {
  TRACE_V1_SCHEMA,
  QUESTION_V2_SCHEMA,
  QUESTION_V1_SCHEMA,
} from '../../scripts/gen-schemas';
import { config } from '../config';

const router = Router();

function serveSchema(schema: Record<string, unknown>, subpath: string) {
  return (_req: Request, res: Response) => {
    const baseUrl = (config as any).PUBLIC_API_BASE_URL || 'https://api.oracledesk.io';
    const dynamicSchema = {
      ...schema,
      $id: `${baseUrl.replace(/\/$/, '')}/api/v1/schemas/${subpath}`,
    };
    res.setHeader('Content-Type', 'application/schema+json');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).json(dynamicSchema);
  };
}

router.get('/trace/v1.json', serveSchema(TRACE_V1_SCHEMA, 'trace/v1.json'));
router.get('/question/v2.json', serveSchema(QUESTION_V2_SCHEMA, 'question/v2.json'));
router.get('/question/v1.json', serveSchema(QUESTION_V1_SCHEMA, 'question/v1.json'));

export default router;
