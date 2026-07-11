export interface PrerequisiteDocument {
  id: string;
  category?: string | null;
  verified: boolean;
}

export interface PrerequisiteCheckResult {
  passed: boolean;
  reason?: string;
}

function hasValidatedGst(
  extractedFields: Record<string, unknown>,
  documents: PrerequisiteDocument[]
): boolean {
  const gstin =
    typeof extractedFields.gstin === 'string'
      ? extractedFields.gstin
      : typeof extractedFields.gstNumber === 'string'
        ? extractedFields.gstNumber
        : null;

  const hasGstDocument = documents.some(
    (document) =>
      document.verified &&
      document.category === 'GST_CERTIFICATE'
  );

  return Boolean(gstin && hasGstDocument);
}

function hasValidatedPan(
  extractedFields: Record<string, unknown>
): boolean {
  const panNumber = extractedFields.panNumber;

  return (
    typeof panNumber === 'string' &&
    /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)
  );
}

function hasValidatedBankProof(
  extractedFields: Record<string, unknown>,
  documents: PrerequisiteDocument[]
): boolean {
  const ifsc = extractedFields.ifsc;
  const accountNumber = extractedFields.accountNumber;

  const hasBankDocument = documents.some(
    (document) =>
      document.verified &&
      document.category === 'BANK_PROOF'
  );

  return (
    typeof ifsc === 'string' &&
    /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc) &&
    typeof accountNumber === 'string' &&
    accountNumber.length >= 8 &&
    accountNumber.length <= 20 &&
    hasBankDocument
  );
}

function hasValidatedIncorporationProof(
  documents: PrerequisiteDocument[]
): boolean {
  return documents.some(
    (document) =>
      document.verified &&
      document.category === 'INCORPORATION_PROOF'
  );
}

function hasValidatedVendorAgreement(
  documents: PrerequisiteDocument[]
): boolean {
  return documents.some(
    (document) =>
      document.verified &&
      document.category === 'VENDOR_AGREEMENT'
  );
}

export function checkPrerequisites(
  targetState: string,
  extractedFields: Record<string, unknown>,
  documents: PrerequisiteDocument[]
): PrerequisiteCheckResult {
  switch (targetState) {
    case 'AWAITING_PAN':
      if (!hasValidatedGst(extractedFields, documents)) {
        return {
          passed: false,
          reason:
            'A validated GST certificate and GSTIN are required before moving to PAN collection.',
        };
      }

      return {
        passed: true,
      };

    case 'AWAITING_BANK':
      if (!hasValidatedPan(extractedFields)) {
        return {
          passed: false,
          reason:
            'A validated PAN is required before moving to bank-proof collection.',
        };
      }

      return {
        passed: true,
      };

    case 'AWAITING_INCORPORATION':
      if (
        !hasValidatedBankProof(
          extractedFields,
          documents
        )
      ) {
        return {
          passed: false,
          reason:
            'A validated bank-proof document with IFSC and account number is required before moving to incorporation-proof collection.',
        };
      }

      return {
        passed: true,
      };

    case 'AWAITING_AGREEMENT':
      if (!hasValidatedIncorporationProof(documents)) {
        return {
          passed: false,
          reason:
            'A verified incorporation-proof document is required before moving to agreement collection.',
        };
      }

      return {
        passed: true,
      };

    case 'VALIDATING':
      if (
        !hasValidatedGst(extractedFields, documents)
      ) {
        return {
          passed: false,
          reason:
            'Validated GST evidence is required before final validation.',
        };
      }

      if (!hasValidatedPan(extractedFields)) {
        return {
          passed: false,
          reason:
            'Validated PAN evidence is required before final validation.',
        };
      }

      if (
        !hasValidatedBankProof(
          extractedFields,
          documents
        )
      ) {
        return {
          passed: false,
          reason:
            'A validated bank-proof document with IFSC and account number is required before final validation.',
        };
      }

      if (!hasValidatedIncorporationProof(documents)) {
        return {
          passed: false,
          reason:
            'A verified incorporation-proof document is required before final validation.',
        };
      }

      if (!hasValidatedVendorAgreement(documents)) {
        return {
          passed: false,
          reason:
            'A verified signed Vendor Agreement document is required before final validation.',
        };
      }

      return {
        passed: true,
      };

    case 'PENDING_APPROVAL':
      if (
        !hasValidatedGst(extractedFields, documents) ||
        !hasValidatedPan(extractedFields) ||
        !hasValidatedBankProof(
          extractedFields,
          documents
        )
      ) {
        return {
          passed: false,
          reason:
            'GST, PAN, and bank-proof validation must all pass before approval.',
        };
      }

      if (!hasValidatedIncorporationProof(documents)) {
        return {
          passed: false,
          reason:
            'A verified incorporation-proof document is required before approval.',
        };
      }

      if (!hasValidatedVendorAgreement(documents)) {
        return {
          passed: false,
          reason:
            'A verified signed Vendor Agreement document is required before approval.',
        };
      }

      return {
        passed: true,
      };

    default:
      return {
        passed: true,
      };
  }
}