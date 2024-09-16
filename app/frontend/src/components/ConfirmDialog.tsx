import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/src/components/ui/alert-dialog";
export function ConfirmDialog({
  alertTrigger,
  dialogTitle,
  dialogDescription,
  onConfirm,
  cancelText,
  confirmText,
}: {
  cancelText?: string,
  confirmText?: string,
  dialogTitle: string,
  dialogDescription: string,
  alertTrigger: React.ReactNode;
  onConfirm: React.MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{alertTrigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {dialogDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            className="bg-red-700 dark:bg-red-600 hover:bg-red-500 dark:hover:bg-red-500 text-white rounded-lg"
          >{cancelText || 'Cancel'} </AlertDialogCancel>
          <AlertDialogAction
            className="bg-blue-500 dark:bg-blue-700 hover:bg-blue-600 dark:hover:bg-blue-600 text-white rounded-lg"
            onClick={onConfirm}>{confirmText || 'Continue'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}