import { motion } from 'framer-motion';
import { ArrowRight, Zap, Shield, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DynamicTemplate from '@/components/public/DynamicTemplate';

// Default Landing Page Component (Fallback)
const DefaultLandingPage = () => {
  // const { t } = useTranslation();

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-background pt-20 pb-32 lg:pt-32">
        <div className="container relative z-10 mx-auto px-4 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mx-auto max-w-4xl"
          >
            <h1 className="mb-6 text-5xl font-bold tracking-tight text-foreground md:text-7xl">
              Build Your Digital Presence <br />
              <span className="text-primary">With Confidence</span>
            </h1>
            <p className="mb-10 text-xl text-muted-foreground md:text-2xl">
              The modern Content Management System designed for performance, flexibility, and growth.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" className="h-12 px-8 text-lg rounded-full">
                Get Started
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button variant="outline" size="lg" className="h-12 px-8 text-lg rounded-full">
                View Demo
              </Button>
            </div>
          </motion.div>
        </div>

        {/* Background Decorative Elements */}
        <div className="absolute top-0 left-0 -z-10 h-full w-full overflow-hidden opacity-20">
          <div className="absolute -top-[20%] -left-[10%] h-[500px] w-[500px] rounded-full bg-primary blur-[100px]"></div>
          <div className="absolute top-[40%] -right-[10%] h-[400px] w-[400px] rounded-full bg-secondary blur-[100px]"></div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="bg-secondary/20 py-24">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">Why Choose AWCMS?</h2>
            <p className="mx-auto max-w-2xl text-muted-foreground">
              Everything you need to manage your content effectively, built on modern technology.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {[
              { icon: Zap, title: "Lightning Fast", desc: "Built on Vite and React for incredible performance and speed." },
              { icon: Shield, title: "Secure by Design", desc: "Enterprise-grade security with Supabase authentication." },
              { icon: Globe, title: "Global Scale", desc: "Ready for international audiences with built-in localization." }
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="group rounded-2xl bg-card p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md border border-border"
              >
                <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="mb-3 text-xl font-bold text-foreground">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-6 text-3xl font-bold md:text-4xl">Ready to transform your content?</h2>
          <p className="mb-10 text-lg opacity-90">
            Join thousands of developers and content creators using AWCMS today.
          </p>
          <Button size="lg" variant="secondary" className="h-12 px-8 rounded-full font-semibold text-secondary-foreground hover:bg-background hover:text-foreground border border-transparent hover:border-border">
            Start Free Trial
          </Button>
        </div>
      </section>
    </div>
  );
};


function Home() {
  return (
    <DynamicTemplate type="homepage" fallback={DefaultLandingPage} />
  );
}

export default Home;
