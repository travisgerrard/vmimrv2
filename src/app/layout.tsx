// Removed font import
import "./globals.css";

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
        {/* Add other head elements */}
      </head>
      <body
        // Restore light gray background and base text color from earlier attempt
        className={`antialiased bg-gray-100 text-gray-900`}
      >
        {/* Render children */}
        {children}
      </body>
    </html>
  );
}
