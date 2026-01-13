export interface MenuItemDTO {
    label: string;
    url: string;
    children?: MenuItemDTO[];
}

export interface MenuDTO {
    id: string;
    tenant_id: string;
    position: 'header' | 'footer';
    items: MenuItemDTO[];
}
