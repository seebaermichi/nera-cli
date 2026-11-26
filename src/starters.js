// The official starters `nera new` offers when the npm registry cannot be
// reached. Hand-kept: add each official @nera-static/starter-* here once it
// is published, so the offline list never names a package that does not
// exist.
export const BUNDLED_STARTERS = [
    {
        name: 'ansitz',
        package: '@nera-static/starter-ansitz',
        label: 'Photo blog',
        description: 'A ready-to-edit Nera photo blog on @nera-static/theme-ansitz: twenty sample posts with photographs, a series, tags, an archive, search, an Atom feed, a sitemap, structured data, canonical links, responsive images, social links and imprint and privacy placeholders.',
    },
    {
        name: 'blank',
        package: '@nera-static/starter-blank',
        label: 'Blank',
        description: 'The smallest Nera starter: a home page, imprint and privacy placeholders, and one accessible layout. No theme, no plugins, no JavaScript.',
    },
    {
        name: 'blog',
        package: '@nera-static/starter-blog',
        label: 'Blog',
        description: 'A ready-to-edit Nera blog on @nera-static/theme-blog: four sample posts with a series, tags, an archive by year, prev/next, an Atom feed, a sitemap, code blocks, navigation, responsive images, social links and imprint and privacy placeholders. No JavaScript.',
    },
    {
        name: 'business',
        package: '@nera-static/starter-business',
        label: 'Business',
        description: 'A ready-to-edit Nera site for a small business on @nera-static/theme-business: home, about, services, opening hours, a contact form, navigation, responsive images, social links, a sitemap, schema.org structured data and imprint and privacy placeholders. One small script for the contact form.',
    },
    {
        name: 'portfolio',
        package: '@nera-static/starter-portfolio',
        label: 'Portfolio',
        description: 'A ready-to-edit Nera portfolio for a designer on @nera-static/theme-business: home, projects with image galleries, about, a contact form, navigation, responsive images, social links, a sitemap, schema.org structured data and imprint and privacy placeholders. One small script for the contact form.',
    },
    {
        name: 'stack',
        package: '@nera-static/starter-stack',
        label: 'Blog for developers',
        description: 'A ready-to-edit Nera blog for developers on @nera-static/theme-stack: fifteen sample posts with two series, highlighted code, tags, an archive, search, an Atom feed, a sitemap, structured data, canonical links, responsive images, social links and imprint and privacy placeholders.',
    },
    {
        name: 'umwege',
        package: '@nera-static/starter-umwege',
        label: 'Travel blog',
        description: 'A ready-to-edit Nera travel blog on @nera-static/theme-umwege: fifteen sample posts with trip facts, places and a series, ten photographs, tags, an archive, search, an Atom feed, a sitemap, structured data, canonical links, responsive images, social links and imprint and privacy placeholders.',
    },
]

// The blogs `nera new --starter blog` asks between on a terminal, in the
// order shown; the plain one first, as the default. Each is in
// BUNDLED_STARTERS, which gives its label.
export const BLOG_STARTERS = ['blog', 'stack', 'ansitz', 'umwege']
