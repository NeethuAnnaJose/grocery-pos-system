import type { NextPageContext } from 'next'

type ErrorProps = {
  statusCode?: number
}

function ErrorPage({ statusCode }: ErrorProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="bg-white rounded-lg shadow p-6 w-full max-w-md text-center">
        <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-sm text-gray-600">
          {statusCode ? `Error ${statusCode}` : 'Unexpected client error'}
        </p>
      </div>
    </div>
  )
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500
  return { statusCode }
}

export default ErrorPage
