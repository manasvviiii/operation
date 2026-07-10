import { ApprovalPanel } from '@/components/ApprovalPanel';
import { getWorkflowData } from '@/lib/context'; // Ensure this path is correct

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workflow = await getWorkflowData(id);

  if (!workflow) {
    return <div>Workflow not found</div>;
  }

  return (
    <div>
      <h1>Workflow: {workflow.id}</h1>
      <p>Current Status: {workflow.state}</p>
      
      {/* Logic to render the correct component */}
      {workflow.state === 'PENDING_APPROVAL' && (
        <ApprovalPanel 
          approvalId={workflow.id} 
          step={workflow.currentStep || 'Pending Review'} 
        />
      )}
    </div>
  );
}