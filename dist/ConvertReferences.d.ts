import React from 'react';
import { SanityClient } from 'sanity';
export interface ConvertReferencesProps {
    client: SanityClient;
    documentTypes?: string[];
    onComplete?: (results: ConversionResult) => void;
    onError?: (error: string) => void;
    batchSize?: number;
    dryRun?: boolean;
    maxDocuments?: number;
}
export interface ConversionResult {
    converted: number;
    errors: string[];
    spaceSaved: number;
}
declare const ConvertReferences: React.FC<ConvertReferencesProps>;
export default ConvertReferences;
