// The official starters `nera new` offers when the npm registry cannot be
// reached. Hand-kept: add each official @nera-static/starter-* here once it
// is published, so the offline list never names a package that does not
// exist.
export const BUNDLED_STARTERS = [
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
        description: 'A ready-to-edit Nera blog on @nera-static/theme-blog: three sample posts, tags, an archive by year, prev/next, an Atom feed, a sitemap, code blocks, navigation, responsive images, social links and imprint and privacy placeholders. No JavaScript.',
    },
]
