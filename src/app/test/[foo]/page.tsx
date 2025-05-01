export default async function TestPage({ params }: { params: { foo: string } }) {
  return <div>Test: {params.foo}</div>;
} 