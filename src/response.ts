export interface xz_range {
    start: string;
    end: string
};
export type xz_ranges = Array<xz_range>;
export interface xz_order_response {
    features: Array<{
        id: string;
        sequence?: string;
        ranges?: xz_ranges;
    }>;
};
