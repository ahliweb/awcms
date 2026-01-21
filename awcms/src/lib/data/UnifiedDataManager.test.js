import { describe, it, expect, vi, beforeEach } from 'vitest';
import { udm } from './UnifiedDataManager';

// Use vi.hoisted to ensure mocks are available before vi.mock calls
const mocks = vi.hoisted(() => {
    const mockSelectBuilder = {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        eq: vi.fn(),
        order: vi.fn(),
        range: vi.fn(),
        single: vi.fn().mockReturnThis(),
        limit: vi.fn(),
        then: vi.fn(),
    };

    // Chainables
    mockSelectBuilder.select.mockReturnValue(mockSelectBuilder);
    mockSelectBuilder.insert.mockReturnValue(mockSelectBuilder);
    mockSelectBuilder.update.mockReturnValue(mockSelectBuilder);
    mockSelectBuilder.delete.mockReturnValue(mockSelectBuilder);
    mockSelectBuilder.eq.mockReturnValue(mockSelectBuilder);
    mockSelectBuilder.order.mockReturnValue(mockSelectBuilder);
    mockSelectBuilder.range.mockReturnValue(mockSelectBuilder);
    mockSelectBuilder.limit.mockReturnValue(mockSelectBuilder);

    // Default promise resolution
    mockSelectBuilder.then.mockImplementation((resolve) => resolve({ data: [], error: null }));

    const mockFrom = vi.fn(() => mockSelectBuilder);

    return {
        mockSelectBuilder,
        mockFrom
    };
});

vi.mock('@/lib/customSupabaseClient', () => {
    return {
        supabase: {
            from: mocks.mockFrom,
        },
    };
});

describe('UnifiedDataManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    describe('Online Mode / Caching', () => {
        it('fetches data from Supabase', async () => {
            // Setup specific return
            mocks.mockSelectBuilder.then.mockImplementation((resolve) => resolve({
                data: [{ id: 1, title: 'Test' }],
                error: null
            }));

            const result = await udm.from('blogs').select('*');

            expect(mocks.mockFrom).toHaveBeenCalledWith('blogs');
            expect(result.data).toEqual([{ id: 1, title: 'Test' }]);
        });
    });
});
