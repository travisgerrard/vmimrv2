// Removed font import
import "./globals.css";
import SWRProvider from "./SWRProvider";

// Removed font setup

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Removed font variable class
    <html lang="en">
      <head>
        <title>Personal Medical Reference</title>
        <meta name="description" content="Manage your personal medical information securely." />
        <link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        {/* Add other head elements */}
      </head>
      <body
        // Restore light gray background and base text color from earlier attempt
        className={`antialiased bg-gray-100 text-gray-900`}
      >
        <SWRProvider>
          {/* Render children */}
          {children}
        </SWRProvider>
      </body>
    </html>
  );
}
