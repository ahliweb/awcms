import React from 'react';

const Footer = () => {
    const year = new Date().getFullYear();

    return (
        <footer className="my-6 rounded-xl border border-border/60 bg-card/90 px-5 py-4 shadow-sm backdrop-blur md:px-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Legal
                    </span>
                    <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        <a href="/" className="text-muted-foreground transition-colors hover:text-foreground">
                            Terms & Conditions
                        </a>
                        <span className="hidden h-3 w-px bg-border/60 sm:inline-block" />
                        <a href="/" className="text-muted-foreground transition-colors hover:text-foreground">
                            Privacy Policy
                        </a>
                        <span className="hidden h-3 w-px bg-border/60 sm:inline-block" />
                        <a href="/" className="text-muted-foreground transition-colors hover:text-foreground">
                            Licensing
                        </a>
                        <span className="hidden h-3 w-px bg-border/60 sm:inline-block" />
                        <a href="/" className="text-muted-foreground transition-colors hover:text-foreground">
                            Cookie Policy
                        </a>
                        <span className="hidden h-3 w-px bg-border/60 sm:inline-block" />
                        <a href="/" className="text-muted-foreground transition-colors hover:text-foreground">
                            Contact
                        </a>
                    </nav>
                </div>
                <p className="text-xs text-muted-foreground md:text-sm">
                    &copy; 2024-{year} <a href="https://ahliweb.com" className="font-medium text-foreground transition-colors hover:text-primary" target="_blank" rel="noreferrer">AhliWeb.com</a>
                    <span className="mx-2 text-border">•</span>
                    AWCMS. All rights reserved.
                </p>
            </div>
        </footer>
    )
}
export default Footer;
