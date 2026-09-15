using UnityEngine;

public class MouseLook : MonoBehaviour
{
    public float sensitivity = 2f;

    private float yaw = 0f;
    private float pitch = 0f;

    void Start()
    {
        yaw = transform.eulerAngles.y;
        pitch = transform.eulerAngles.x;
    }

    void Update()
    {
        float mouseX = Input.GetAxis("Mouse X") * sensitivity;
        float mouseY = Input.GetAxis("Mouse Y") * sensitivity;

        yaw += mouseX;
        pitch -= mouseY;
        pitch = Mathf.Clamp(pitch, -80f, 80f);

        transform.localRotation = Quaternion.Euler(pitch, yaw, 0f);
    }
}