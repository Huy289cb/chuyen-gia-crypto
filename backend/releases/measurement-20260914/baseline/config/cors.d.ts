import cors from 'cors';
export declare const corsMiddleware: (req: cors.CorsRequest, res: {
    statusCode?: number | undefined;
    setHeader(key: string, value: string): any;
    end(): any;
}, next: (err?: any) => any) => void;
export declare const isOriginAllowed: (origin: string | undefined) => boolean;
//# sourceMappingURL=cors.d.ts.map