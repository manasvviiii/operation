import { describe, it, expect } from 'vitest';
import { validateTransition, TRANSITION_MAP } from './stateMachine';

describe('stateMachine', () => {
  describe('TRANSITION_MAP', () => {
    it('should have all defined states', () => {
      const expectedStates = [
        'INITIATED',
        'AWAITING_GST',
        'AWAITING_PAN',
        'AWAITING_BANK',
        'AWAITING_INCORPORATION',
        'AWAITING_AGREEMENT',
        'VALIDATING',
        'PENDING_APPROVAL',
        'WRITING_ERP',
        'COMPLETED',
        'FAILED',
        'CANCELLED',
        'PAUSED',
      ];

      expectedStates.forEach((state) => {
        expect(TRANSITION_MAP).toHaveProperty(state);
      });
    });

    it('should allow transitions from INITIATED to AWAITING_GST', () => {
      expect(TRANSITION_MAP.INITIATED).toContain('AWAITING_GST');
    });

    it('should allow transitions from AWAITING_GST to AWAITING_PAN', () => {
      expect(TRANSITION_MAP.AWAITING_GST).toContain('AWAITING_PAN');
    });

    it('should allow transitions from AWAITING_PAN to AWAITING_BANK', () => {
      expect(TRANSITION_MAP.AWAITING_PAN).toContain('AWAITING_BANK');
    });

    it('should allow transitions from AWAITING_BANK to AWAITING_INCORPORATION', () => {
      expect(TRANSITION_MAP.AWAITING_BANK).toContain('AWAITING_INCORPORATION');
    });

    it('should allow transitions from AWAITING_INCORPORATION to AWAITING_AGREEMENT', () => {
      expect(TRANSITION_MAP.AWAITING_INCORPORATION).toContain('AWAITING_AGREEMENT');
    });

    it('should allow transitions from AWAITING_AGREEMENT to VALIDATING', () => {
      expect(TRANSITION_MAP.AWAITING_AGREEMENT).toContain('VALIDATING');
    });

    it('should allow transitions from VALIDATING to PENDING_APPROVAL', () => {
      expect(TRANSITION_MAP.VALIDATING).toContain('PENDING_APPROVAL');
    });

    it('should allow transitions from PENDING_APPROVAL to WRITING_ERP', () => {
      expect(TRANSITION_MAP.PENDING_APPROVAL).toContain('WRITING_ERP');
    });

    it('should allow transitions from WRITING_ERP to COMPLETED', () => {
      expect(TRANSITION_MAP.WRITING_ERP).toContain('COMPLETED');
    });

    it('should allow transitions from any non-terminal state to FAILED', () => {
      const nonTerminalStates = [
        'INITIATED',
        'AWAITING_GST',
        'AWAITING_PAN',
        'AWAITING_BANK',
        'AWAITING_INCORPORATION',
        'AWAITING_AGREEMENT',
        'VALIDATING',
        'PENDING_APPROVAL',
        'WRITING_ERP',
      ];

      nonTerminalStates.forEach((state) => {
        expect(TRANSITION_MAP[state]).toContain('FAILED');
      });
    });

    it('should allow transitions from any non-terminal state to CANCELLED', () => {
      const nonTerminalStates = [
        'INITIATED',
        'AWAITING_GST',
        'AWAITING_PAN',
        'AWAITING_BANK',
        'AWAITING_INCORPORATION',
        'AWAITING_AGREEMENT',
        'VALIDATING',
        'PENDING_APPROVAL',
        'WRITING_ERP',
      ];

      nonTerminalStates.forEach((state) => {
        expect(TRANSITION_MAP[state]).toContain('CANCELLED');
      });
    });

    it('should allow transitions from any non-terminal state to PAUSED', () => {
      const nonTerminalStates = [
        'INITIATED',
        'AWAITING_GST',
        'AWAITING_PAN',
        'AWAITING_BANK',
        'AWAITING_INCORPORATION',
        'AWAITING_AGREEMENT',
        'VALIDATING',
        'PENDING_APPROVAL',
        'WRITING_ERP',
      ];

      nonTerminalStates.forEach((state) => {
        expect(TRANSITION_MAP[state]).toContain('PAUSED');
      });
    });

    it('should have no transitions from COMPLETED', () => {
      expect(TRANSITION_MAP.COMPLETED).toEqual([]);
    });

    it('should have no transitions from FAILED', () => {
      expect(TRANSITION_MAP.FAILED).toEqual([]);
    });

    it('should have no transitions from CANCELLED', () => {
      expect(TRANSITION_MAP.CANCELLED).toEqual([]);
    });

    it('should allow transitions from PAUSED to FAILED and CANCELLED', () => {
      expect(TRANSITION_MAP.PAUSED).toContain('FAILED');
      expect(TRANSITION_MAP.PAUSED).toContain('CANCELLED');
    });

    it('should NOT allow AWAITING_BANK to transition directly to VALIDATING', () => {
      expect(TRANSITION_MAP.AWAITING_BANK).not.toContain('VALIDATING');
    });
  });

  describe('validateTransition', () => {
    it('should pass for valid forward transitions', () => {
      expect(() => validateTransition('INITIATED', 'AWAITING_GST')).not.toThrow();
      expect(() => validateTransition('AWAITING_GST', 'AWAITING_PAN')).not.toThrow();
      expect(() => validateTransition('AWAITING_PAN', 'AWAITING_BANK')).not.toThrow();
      expect(() => validateTransition('AWAITING_BANK', 'AWAITING_INCORPORATION')).not.toThrow();
      expect(() => validateTransition('AWAITING_INCORPORATION', 'AWAITING_AGREEMENT')).not.toThrow();
      expect(() => validateTransition('AWAITING_AGREEMENT', 'VALIDATING')).not.toThrow();
      expect(() => validateTransition('VALIDATING', 'PENDING_APPROVAL')).not.toThrow();
      expect(() => validateTransition('PENDING_APPROVAL', 'WRITING_ERP')).not.toThrow();
      expect(() => validateTransition('WRITING_ERP', 'COMPLETED')).not.toThrow();
    });

    it('should pass for transitions to terminal states', () => {
      expect(() => validateTransition('INITIATED', 'FAILED')).not.toThrow();
      expect(() => validateTransition('AWAITING_GST', 'CANCELLED')).not.toThrow();
      expect(() => validateTransition('VALIDATING', 'PAUSED')).not.toThrow();
      expect(() => validateTransition('AWAITING_INCORPORATION', 'FAILED')).not.toThrow();
      expect(() => validateTransition('AWAITING_AGREEMENT', 'CANCELLED')).not.toThrow();
    });

    it('should throw for invalid transitions', () => {
      expect(() => validateTransition('INITIATED', 'COMPLETED')).toThrow();
      expect(() => validateTransition('AWAITING_GST', 'WRITING_ERP')).toThrow();
      expect(() => validateTransition('COMPLETED', 'INITIATED')).toThrow();
      expect(() => validateTransition('FAILED', 'AWAITING_GST')).toThrow();
      expect(() => validateTransition('AWAITING_BANK', 'VALIDATING')).toThrow();
    });

    it('should throw descriptive error messages', () => {
      expect(() => validateTransition('INITIATED', 'COMPLETED')).toThrow(/Invalid state transition/);
      expect(() => validateTransition('INITIATED', 'COMPLETED')).toThrow(/INITIATED/);
      expect(() => validateTransition('INITIATED', 'COMPLETED')).toThrow(/COMPLETED/);
    });

    it('should throw for reverse transitions', () => {
      expect(() => validateTransition('AWAITING_GST', 'INITIATED')).toThrow();
      expect(() => validateTransition('VALIDATING', 'AWAITING_GST')).toThrow();
      expect(() => validateTransition('AWAITING_AGREEMENT', 'AWAITING_INCORPORATION')).toThrow();
    });
  });
});
