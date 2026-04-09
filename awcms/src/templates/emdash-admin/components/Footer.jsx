import React, { useMemo, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { sanitizeHTML } from '@/utils/sanitize';

const Footer = () => {
    const year = new Date().getFullYear();
    const [activeLegalPage, setActiveLegalPage] = useState(null);

    const legalLinks = useMemo(() => {
        const portalBase = import.meta.env.VITE_PUBLIC_PORTAL_URL || 'http://localhost:4321';
        return [
            {
                label: 'Terms & Conditions',
                path: '/id/p/terms',
                description: 'Platform legal terms for AhliWeb and AWCMS service usage.',
                content: `
                  <p>Halaman ini menjelaskan penggunaan layanan AhliWeb dan AWCMS berdasarkan profesionalitas, kepatuhan hukum, dan nilai syariah sesuai pemahaman Salafus Shalih.</p>
                  <h2>Pokok Ketentuan</h2>
                  <ul>
                    <li>Ruang lingkup layanan mengikuti akad, proposal, atau kontrak yang sah.</li>
                    <li>Permintaan yang melanggar hukum, etika, atau syariat dapat ditolak.</li>
                    <li>Pengguna wajib menjaga akses, materi, dan akun dengan aman.</li>
                  </ul>
                `,
            },
            {
                label: 'Privacy Policy',
                path: '/id/p/privacy',
                description: 'Platform privacy commitments and data stewardship details.',
                content: `
                  <p>AhliWeb menjaga amanah data pelanggan, pengunjung, dan mitra dengan kontrol akses, audit log, segmentasi tenant, serta perlindungan infrastruktur yang proporsional.</p>
                  <h2>Cakupan Data</h2>
                  <ul>
                    <li>Identitas dasar dan kebutuhan proyek.</li>
                    <li>Log teknis dan performa untuk keamanan dan audit.</li>
                    <li>Dokumen serta aset proyek yang diserahkan secara sah.</li>
                  </ul>
                `,
            },
            {
                label: 'Licensing',
                path: '/id/p/licensing',
                description: 'Usage and licensing guidance for platform deliverables.',
                content: `
                  <p>Lisensi deliverable AhliWeb mengikuti akad dan tidak otomatis memindahkan seluruh hak atas komponen pihak ketiga, open-source, atau modul internal.</p>
                  <h2>Ringkasan Lisensi</h2>
                  <ul>
                    <li>Hak penggunaan berlaku sesuai tujuan bisnis yang disepakati.</li>
                    <li>Hak eksklusif atau pengalihan hak cipta harus dinyatakan tertulis.</li>
                    <li>Kepatuhan terhadap lisensi pihak ketiga wajib dijaga.</li>
                  </ul>
                `,
            },
            {
                label: 'Cookie Policy',
                path: '/id/p/cookie-policy',
                description: 'Cookie and similar technology usage for the platform.',
                content: `
                  <p>Cookie dan teknologi serupa digunakan untuk keamanan sesi, preferensi dasar, dan analitik yang transparan tanpa praktik manipulatif.</p>
                  <h2>Jenis Cookie</h2>
                  <ul>
                    <li>Cookie esensial untuk autentikasi dan keamanan.</li>
                    <li>Cookie analitik untuk memahami penggunaan secara agregat.</li>
                    <li>Cookie fungsional untuk navigasi dan pengalaman pengguna.</li>
                  </ul>
                `,
            },
            {
                label: 'Contact',
                path: '/id/p/contact',
                description: 'Official AhliWeb contact details and communication channels.',
                content: `
                  <p>AhliWeb melayani kebutuhan transformasi digital, pengembangan aplikasi, automasi bisnis, cloud, dan konsultasi sesuai prinsip amanah dan profesionalitas.</p>
                  <h2>Kanal Resmi</h2>
                  <ul>
                    <li>PT Ahli Web Internasional</li>
                    <li>Jl. Sutan Syahrir Gg. Lombok 1, Arut Selatan, Pangkalan Bun</li>
                    <li>WhatsApp: +62-895-1338-0400</li>
                    <li>Email: info@ahliweb.com / halo@ahliweb.com</li>
                  </ul>
                `,
            },
        ].map((item) => ({
            ...item,
            href: `${portalBase}${item.path}`,
        }));
    }, []);

    const handleOpenLegalPage = (link) => {
        setActiveLegalPage(link);
    };

    return (
        <>
        <footer className="emdash-panel relative my-4 overflow-hidden px-5 py-4 md:px-6">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            EmDash Legal
                        </span>
                        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                            {legalLinks.map((link, index) => (
                                <React.Fragment key={link.path}>
                                    {index !== 0 ? <span className="hidden h-3 w-px bg-border/60 sm:inline-block" /> : null}
                                    <button
                                        type="button"
                                        onClick={() => handleOpenLegalPage(link)}
                                        className="text-left text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                        {link.label}
                                    </button>
                                </React.Fragment>
                            ))}
                        </nav>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground md:text-sm">
                    &copy; 2024-{year} <a href="https://ahliweb.com" className="font-medium text-foreground transition-colors hover:text-primary" target="_blank" rel="noreferrer">AhliWeb.com</a>
                    <span className="mx-2 text-border">•</span>
                    AWCMS. All rights reserved.
                </p>
            </div>
        </footer>
        <Dialog open={Boolean(activeLegalPage)} onOpenChange={(open) => !open && setActiveLegalPage(null)}>
            <DialogContent className="max-w-5xl overflow-hidden border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,245,249,0.96))] p-0 shadow-[0_30px_90px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-slate-700/80 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.95))]">
                <DialogHeader className="border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(238,242,255,0.95),rgba(255,255,255,0.9))] px-6 py-5 dark:border-slate-800/80 dark:bg-[linear-gradient(135deg,rgba(30,41,59,0.95),rgba(15,23,42,0.92))]">
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1.5">
                            <DialogTitle className="flex items-center gap-2">
                                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/15">
                                    <FileText className="h-4 w-4" />
                                </span>
                                <span>{activeLegalPage?.label || 'Legal Page'}</span>
                            </DialogTitle>
                            <DialogDescription>{activeLegalPage?.description}</DialogDescription>
                            <code className="inline-flex rounded-full border border-slate-200/80 bg-white/90 px-3 py-1 text-xs font-mono text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                                {activeLegalPage?.href}
                            </code>
                        </div>
                        {activeLegalPage?.href ? (
                            <Button asChild variant="outline" className="rounded-xl border-slate-200/80 bg-white/90 shadow-sm hover:bg-white dark:border-slate-700 dark:bg-slate-900/70 dark:hover:bg-slate-900">
                                <a href={activeLegalPage.href} target="_blank" rel="noreferrer">
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                    Open in new tab
                                </a>
                            </Button>
                        ) : null}
                    </div>
                </DialogHeader>

                <div className="max-h-[80vh] overflow-y-auto bg-[linear-gradient(180deg,rgba(248,250,252,0.85),rgba(241,245,249,0.65))] px-6 py-6 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(15,23,42,0.7))]">
                    {activeLegalPage ? (
                        <div className="space-y-5">
                            <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/85">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Page URL</p>
                                <a
                                    href={activeLegalPage.href}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-2 inline-flex break-all text-sm font-medium text-primary hover:underline"
                                >
                                    {activeLegalPage.href}
                                </a>
                            </div>

                            <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-950/90">
                                <div className="prose prose-slate prose-headings:font-semibold prose-headings:tracking-tight prose-p:text-slate-700 prose-li:text-slate-700 max-w-none dark:prose-invert dark:prose-p:text-slate-200 dark:prose-li:text-slate-200" dangerouslySetInnerHTML={sanitizeHTML(activeLegalPage.content || '')} />
                            </div>
                        </div>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
        </>
    )
}
export default Footer;
