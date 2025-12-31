import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const CLEANUP_FUNCTION_NAME = process.env.CLEANUP_FUNCTION_NAME!;
const lambda = new LambdaClient({});

export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  try {
    console.log('[TRIGGER] Manually triggering connection cleanup');
    
    // Invoke the cleanup function
    const response = await lambda.send(
      new InvokeCommand({
        FunctionName: CLEANUP_FUNCTION_NAME,
        InvocationType: 'RequestResponse', // Synchronous invocation
      })
    );

    // Parse the response
    const result = JSON.parse(
      new TextDecoder().decode(response.Payload)
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Cleanup triggered successfully',
        result,
      }),
    };
  } catch (error) {
    console.error('[TRIGGER] Failed to trigger cleanup:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to trigger cleanup',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

